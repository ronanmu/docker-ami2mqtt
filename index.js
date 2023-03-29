'use strict'
//
//
// Uses Asterisk AMI to route caller-id information to a MQTT broker
// 
// Also handles extenstion to extension calls
// 
// Does not handle outgoing calls
// 
// Significant Events:
// 	56   event: 'DialBegin',
// 	56   event: 'DialEnd',
// 	77   event: 'Hangup',
// 	75   event: 'NewConnectedLine',
// 	67   event: 'Newstate',
// 
// Significant States:
// 	channelstatedesc: 'Down',
// 	channelstatedesc: 'Ring',
// 	channelstatedesc: 'Ringing',
// 	channelstatedesc: 'Up',
// 
// Sample event message:
// 	event: 'NewConnectedLine',
// 	channelstatedesc: 'Ring',
// 	channel:
// 	exten: '12125551212',
// 	destexten: '323',
// 	calleridnum: '15105551212',
// 	calleridname: 'ROAD RUNNER',
// 	connectedlinenum: '12125551212',
// 	connectedlinename: '',
// 	destcalleridnum: '323',
// 	destcalleridname: 'Wile Coyote',
// 
//

var util = require('util')
var namiLib = require("nami")
var mqtt = require("mqtt")

const amiPort = (typeof process.env.AMI_PORT !== 'undefined') ? process.env.AMI_PORT : 5038;
const amiHost = (typeof process.env.AMI_HOST !== 'undefined') ? process.env.AMI_HOST : 'asterisk';
const amiUser = (typeof process.env.AMI_USERNAME !== 'undefined') ? process.env.AMI_USERNAME : 'asterisk';
const amiPass = (typeof process.env.AMI_PASSWORD !== 'undefined') ? process.env.AMI_PASSWORD : 'manager';
const mqttHost = (typeof process.env.MQTT_HOST !== 'undefined') ? process.env.MQTT_HOST : 'mosquitto';
const mqttPort = (typeof process.env.MQTT_PORT !== 'undefined') ? process.env.MQTT_PORT : 1883;
const mqttKeepalive = (typeof process.env.MQTT_KEEPALIVE !== 'undefined') ? process.env.MQTT_KEEPALIVE : 60;
const mqttUser = (typeof process.env.MQTT_USERNAME !== 'undefined') ? process.env.MQTT_USERNAME : null;
const mqttPass = (typeof process.env.MQTT_PASSWORD !== 'undefined') ? process.env.MQTT_PASSWORD : null;
const mqttPrefix = (typeof process.env.MQTT_PREFIX !== 'undefined') ? process.env.MQTT_PREFIX : 'pbx';

//var config = require('/config/config.json');

String.prototype.inList = function(list) {
    return (list.indexOf(this.toString()) != -1)
}

// Normalize phone numbers => Country code + Number

String.prototype.telnumClean = function() {

    return this
}

// Is a phone number internal or external 

var ext_re = ''
var int_re = ''

String.prototype.isInternal = function() {

    // Is it internal. Assume anything shorter than 5 digits is
    if (this.length < 5) {
        return true
    }
    // Default is assume external
    return false
}

String.prototype.isExternal = function() {
    return !this.isInternal()
}

var ami_conf = {
   "host": amiHost,
   "port": amiPort,
   "username": amiUser,
   "secret": amiPass
}


/* Incoming lines => event.connectedlinenum */

var trunks = {}

var callers = {}

var calls = {}

var max_internal = 4

var ami_activity = Date.now()
var mqtt_activity = Date.now()

var client = mqtt.connect({
    host: mqttHost,
    port: mqttPort,
    username: mqttUser,
    password: mqttPass,
    keepalive: mqttKeepalive
})

client.on('connect', function() {
    console.log("Connected to MQTT Broker")
    client.subscribe(mqttPrefix + '/_ping')
})

var nami = new(namiLib.Nami)(ami_conf)

nami.logLevel = 1

nami.on('namiConnectionClose', function(data) {
    console.warn('Reconnecting to AMI...');
    setTimeout(function() {
        nami.open();
    }, 5000);
});

nami.on('namiConnected', function(data) {
    console.log("Connected to AMI")
});
nami.on('namiInvalidPeer', function(data) {
    console.error("Invalid AMI Salute. Not an AMI?");
    process.exit(1);
});
nami.on('namiLoginIncorrect', function() {
    console.error("Invalid AMI Credentials");
    process.exit(1);
});
nami.on('namiEvent', function(event) {
    ami_activity = Date.now()

    if (!event.event.inList(['NewConnectedLine', 'DialBegin', 'DialEnd', 'Hangup'])) {
        return
    }
    if (!event.channelstatedesc.inList(['Down', 'Rsrvd', 'Ring', 'Ringing', 'Up'])) {
        return
    }

    // var tmp = []
    // tmp[ 0 ] = event.event
    // tmp[ 1 ] = event.channelstatedesc
    // tmp[ 2 ] = event.channel.replace( /^[^\/]+\//, '' ).replace( /-[^-]+$/, '' )
    // tmp[ 3 ] = event.exten
    // tmp[ 4 ] = event.destexten
    // tmp[ 5 ] = event.calleridnum
    // tmp[ 6 ] = event.calleridname
    // tmp[ 7 ] = event.connectedlinenum
    // tmp[ 8 ] = event.connectedlinename
    // tmp[ 9 ] = event.destcalleridnum
    // tmp[ 10 ] = event.destcalleridname

    delete event.lines
    delete event.EOL
    console.log(util.inspect(event))

    // Process New incoming call on Trunk
    // Trunk incoming
    if (event.event === 'NewConnectedLine' &&
        event.channelstatedesc === 'Ring' &&
	event.calleridnum.isExternal() &&
        trunks[event.connectedlinenum]) {
        callers[event.calleridnum] = event.calleridname.replace(/[_\s]+/g, ' ')
        var trunk = trunks[event.connectedlinenum].toLowerCase()
        var tmp = {
            trunk: trunks[event.connectedlinenum],
            to_num: event.connectedlinenum,
            from_num: event.calleridnum === 'Unavailable' ? '' : event.calleridnum.telnumClean(),
            from_name: event.calleridname.replace(/[_\s]+/g, ' '),
            direction: 'in',
            state: 'ring',
            timestamp: Date(),
        }
        calls[event.linkedid] = tmp;

        client.publish(mqttPrefix + '/trunk/' + trunk, JSON.stringify(tmp))
    }
    // Trunk outgoing
    else if (event.event === 'DialBegin' &&
        event.channelstatedesc === 'Ring' &&
	event.destcalleridnum &&
	event.destcalleridnum.isExternal() &&
        trunks[event.calleridnum] ) {
        var trunk = trunks[event.calleridnum].toLowerCase()
        var tmp = {
            trunk: trunks[event.calleridnum],
            to_num: event.destcalleridnum.telnumClean(),
            from_num: event.calleridnum === 'Unavailable' ? '' : event.calleridnum,
            from_name: calls[event.linkedid] ? calls[event.linkedid].from_name : event.calleridname.replace(/[_\s]+/g, ' '),
            direction: 'out',
            state: 'ring',
            timestamp: Date(),
        }

        calls[event.linkedid] = tmp;

        client.publish(mqttPrefix + '/trunk/' + trunk, JSON.stringify(tmp))
    }
    // Trunk Answer
    else if (event.event === 'DialEnd' &&
        ( callers[event.calleridnum] || trunks[event.calleridnum] ) &&
        calls[event.linkedid] &&
        event.destchannelstatedesc === 'Up') {
	if ( event.destcalleridnum.isInternal() ) {
	    calls[event.linkedid].exten = event.destcalleridnum
	}
        var tmp = calls[event.linkedid]
        var trunk = tmp.trunk.toLowerCase()
        tmp.state = 'answer'
        tmp.timestamp = Date()

        client.publish(mqttPrefix + '/trunk/' + trunk, JSON.stringify(tmp))
    }
    // Trunk Hangup
    else if (event.event === 'Hangup' &&
        event.channelstatedesc === 'Up' &&
        calls[event.linkedid] &&
        ( callers[event.calleridnum] || trunks[event.calleridnum] ) ) {
        var tmp = calls[event.linkedid]
        var trunk = tmp.trunk.toLowerCase()
        tmp.state = 'hangup'
        tmp.timestamp = Date()

        client.publish(mqttPrefix + '/trunk/' + trunk, JSON.stringify(tmp))
    }

    // Internal/Extension processing
    // Ring internal extensions
    if (event.event === 'DialBegin' &&
        event.channelstatedesc === 'Ring' &&
        event.destcalleridnum &&
	event.destcalleridnum.isInternal()) {
        var ext = event.destcalleridnum
        var tmp = {
            to_num: event.destcalleridnum,
            from_num: event.calleridnum === 'Unavailable' ? '' : event.calleridnum.telnumClean(),
            from_name: calls[event.linkedid] ? calls[event.linkedid].from_name : event.calleridname.replace(/[_\s]+/g, ' '),
            state: 'ring',
            timestamp: Date(),
        }
        // Was this an internal call?
        if (!calls[event.linkedid]) {
	    tmp.exten = ext
            calls[event.linkedid] = tmp;
        }

	if ( tmp.from_num && tmp.from_num.isInternal() && !calls[event.linkedid].trunk ) {
		client.publish(mqttPrefix + '/extension/' + tmp.from_num , JSON.stringify(tmp))
	}
        client.publish(mqttPrefix + '/extension/' + ext, JSON.stringify(tmp))
    }
    // Extension Answer
    else if (event.event === 'DialEnd' &&
        calls[event.linkedid] &&
        event.destcalleridnum &&
	event.destcalleridnum.isInternal() &&
        event.destchannelstatedesc === 'Up') {
        var ext = event.destcalleridnum
        var tmp = {
            to_num: event.destcalleridnum,
            from_num: event.calleridnum === 'Unavailable' ? '' : event.calleridnum.telnumClean(),
            from_name: calls[event.linkedid] ? calls[event.linkedid].from_name : event.calleridname.replace(/[_\s]+/g, ' '),
            state: 'answer',
            timestamp: Date(),
        }

	if ( tmp.from_num && !calls[event.linkedid].trunk ) {
		client.publish(mqttPrefix + '/extension/' + tmp.from_num , JSON.stringify(tmp))
	}
        client.publish(mqttPrefix + '/extension/' + ext, JSON.stringify(tmp))
    }
    // Extension Hangup
    else if (event.event === 'Hangup' &&
        event.channelstatedesc === 'Up' &&
        calls[event.linkedid] &&
	calls[event.linkedid].exten == event.calleridnum &&
        event.calleridnum &&
        event.calleridnum.isInternal() ) {
        var ext = event.calleridnum
        var tmp = {
            to_num: event.calleridnum,
            from_num: event.connectedlinenum === 'Unavailable' ? '' : event.connectedlinenum.telnumClean(),

            from_name: calls[event.linkedid] ? calls[event.linkedid].from_name : event.calleridname.replace(/[_\s]+/g, ' '),
            state: 'hangup',
            timestamp: Date(),
        }

	if ( tmp.from_num && !calls[event.linkedid].trunk ) {
		client.publish(mqttPrefix + '/extension/' + tmp.from_num , JSON.stringify(tmp))
	}
        client.publish(mqttPrefix + '/extension/' + ext, JSON.stringify(tmp))
    }
})

process.on('SIGTERM', function() {
    nami.close(function() {
        console.warn("Exiting on SIGTERM")
    })
    process.exit(1)
})
process.on('SIGINT', function() {
    nami.close(function() {
        console.warn("Exiting on SIGINT")
    })
    process.exit(1)
})

// MQTT Activity

client.on('message', function(topic, message) {
    mqtt_activity = Date.now()
})

// AMI Keepalive

setInterval(function() {
    nami.send(new namiLib.Actions.Ping(), function(response) {
        if (response.ping !== 'Pong') {
            return
        }
        ami_activity = Date.now()
    })
}, 60000)

// MQTT Keepalive
setInterval(function() {
    client.publish(mqttPrefix + '/_ping', JSON.stringify({
        timestamp: Date()
    }))
}, 60000)

setInterval(function() {
    var ami_last = (Date.now() - ami_activity) / 1000.0
    if (ami_last >= 90) {
        console.warn("Exit due to AMI inactivity")
        process.exit(10)
    }
    var mqtt_last = (Date.now() - mqtt_activity) / 1000.0
    if (mqtt_last >= 90) {
        console.warn("Exit due to MQTT inactivity")
        process.exit(10)
    }
}, 10000)

console.log("Starting")

nami.open()
