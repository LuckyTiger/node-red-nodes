/**
 * Copyright 2013 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

var RED = require(process.env.NODE_RED_HOME+"/red/red");

var Heatmiser = require("heatmiser");
var util =  require('util');

function HeatmiserNode(n) {
	// TODO - holiday and hot water cases when confirmed working
	var DEBUG = true;
    RED.nodes.createNode(this,n);
    this.ip = n.ip || "192.168.0.1";
    this.pin = n.pin || "1234";
    this.multiWriteFunc = undefined;
    that = this;

    this.hm = new Heatmiser(this.ip, this.pin);

    this.hm.on('success', function(data) {
		if (DEBUG) {
			util.log(JSON.stringify(data));
		}
		that.currentStatus = data.dcb;
		if (that.multiWriteFunc) {
			that.multiWriteFunc();
			that.multiWriteFunc = undefined;
			return;
		}
		that.send(data.dcb);
	});
	this.hm.on('error', function(data) {
		if (DEBUG) {
			console.log(JSON.stringify(data));
		}
		that.send(data);
	});

	this.read = function() {
		that.hm.read_device();
	};

	if (!this.currentStatus) {
		this.read();
		setInterval(this.read, 30000);
	}

	this.write = function(dcb) {
		that.hm.write_device(dcb);
	};

	this.validateAndWrite = function(message) {
		for (var key in message.payload) {
				// Ensure our valid keys contain valid values
				switch(key) {
					case "runmode" :
						if (DEBUG) {
							util.log("[100-heatmiser.js] Hit the runmode case");
						}
						if (message.payload[key] !== "frost" && message.payload[key] !== "heating") {
							util.log("[100-heatmiser.js] Warning: Unsupported 'runmode' value passed!");
							return;
						}
						break;

					// case "holiday" :
					// 	if (DEBUG) {
					// 		util.log("[100-heatmiser.js] Hit the holiday case");
					// 	}
					// 	if (!('enabled' in message.payload[key]) && !('time' in message.payload[key])) {
					// 		util.log("[100-heatmiser.js] Warning: Unsupported 'holiday' value passed!");
					// 		return;
					// 	}
					// 	var time = message.payload[key].time;
					// 	// Ensure that time is a date
					// 	if (typeof(time) == "string") {
					// 		util.log("Typeof time was " +typeof(message.payload[key].time));
					// 		// message.payload[key].time = new Date(message.payload[key].time);
					// 		message.payload[key].time = new Date(2014, 02, 15, 12, 0, 0);
					// 		util.log("Typeof time is now " +typeof(message.payload[key].time));
					// 	}
					// 	// Also add in away mode (for hot water) if we're on hols
					// 	if (message.payload[key].time) {
					// 		message.payload.away_mode = 1;
					// 	}
					// 	else {
					// 		message.payload.away_mode = 0;	
					// 	}
					// 	break;

					// case "hotwater" :
					// 	if (DEBUG) {
					// 		util.log("[100-heatmiser.js] Hit the hotwater case");
					// 	}
					// 	if (message.payload[key] !== "on" && message.payload[key] !== "boost" && message.payload[key] !== "off") {
					// 		util.log("[100-heatmiser.js] Warning: Unsupported 'hotwater' value passed!");
					// 		return;
					// 	}
					// 	break;

					case "heating" :
						// Ensure heating stays last! It's got a multi write scenario
						if (DEBUG) {
							util.log("[100-heatmiser.js] Hit the heating case");
						}
						if (!('target' in message.payload[key]) && !('hold' in message.payload[key])) {
							util.log("[100-heatmiser.js] Warning: Unsupported 'heating' value passed!");
							return;
						}
						// Set sane temp and time ranges and sanitise to float/int
						var target = parseFloat(message.payload[key].target);
						var hold = parseInt(message.payload[key].hold);
						(target > 30.0) ? message.payload[key].target = 30.0 : message.payload[key].target = target;
						(hold > 1440) ? message.payload[key].hold = 1440 : message.payload[key].hold = hold;
						(target <= 10.0) ? message.payload[key].target = 10.0 : message.payload[key].target = target;
						(hold <= 0) ? message.payload[key].hold = 0 : message.payload[key].hold = hold;

						// Ensure that runmode == heating first
						if (that.currentStatus.run_mode === "frost_protection") {
							// Use the multiWriteFunc as a callback in our success case
							that.multiWriteFunc = function() {
								that.write(message.payload);
							}
							that.write({"runmode" : "heating"});
							// End the flow here to ensure no double-writing
							return;
						}
						break;

					default :
						if (DEBUG) {
							util.log("[100-heatmiser.js] Hit the default case");
						}
						that.read();
				}
			}
			// Valid set of key messages, construct DCB and write
			var dcb = message.payload;
			if (DEBUG) {
				util.log("[100-heatmiser.js] Injecting " + JSON.stringify(dcb));
			}
			that.write(dcb);
	};

    this.on("input", function(message) {
		// Valid inputs are heating:{target:, hold:}, read:, runmode:frost/heating, holiday:{enabled:, time:}, hotwater:{'on':1/0 / 'boost':1/0}
		if (typeof(message.payload) == "string") {
			message.payload = JSON.parse(message.payload);
		}
		if (message.payload.read) {
			that.hm.read_device();
		}
		else if (message.payload) {
			// Compare message.payload data to confirm valid and send to thermostat
			var validInputs = ["heating", "runmode"];
			for (var key in message.payload) {
				if (message.payload.hasOwnProperty(key)) {
					if (validInputs.indexOf(key) < 0) {
						util.log("[100-heatmiser.js] Warning: Unsupported key ("+key+") passed!");
						return;
					}
				}
			}
			that.validateAndWrite(message);
		}
    });
}
RED.nodes.registerType("heatmiser",HeatmiserNode);
