'use strict';

module.exports = function (RED) {
    var homeDir = process.env.NODE_RED_HOME;

    var path = require('path'),
        mqttCP = require(path.resolve(homeDir, './nodes/core/io/lib/mqttConnectionPool.js'));

    var flows = require('./js/flows'),
        handler = require('./js/handler'),
        outNode = require('./js/outNode'),
        zwave = require('./js/openZWave').zwave;

    var mqtt = null,
        client = false,
        zwaveConnected = false,
        mqttConnected = false;

    function zwaveController(config) {
        RED.nodes.createNode(this, config);
        this.topic = config.topic;
        this.broker = config.broker;
        this.brokerConfig = RED.nodes.getNode(this.broker);
        var node = this;
        node.status({
            fill: 'grey',
            shape: 'dot',
            text: 'node-red:common.status.not-connected'
        });
        if (typeof this.brokerConfig != 'undefined') {
            if (!mqtt) {
                mqtt = mqttCP.get(
                    node.brokerConfig.broker,
                    node.brokerConfig.port
                );
                mqtt.on('connectionlost', function () {
                    node.warn('Connection to MQTT lost');
                });
                mqtt.on('connect', function () {
                    node.log('Connection to MQTT established');
                });
                mqtt.connect();
                mqttConnected = true;
            }

            zwave.lastY = [];

            zwave.on('driver ready', function (homeid) {
                handler.driverReady(node, RED, client, homeid);
            });

            zwave.on('driver failed', function () {
                handler.driverFailed(node);
            });

            zwave.on('node added', function (nodeid) {
                handler.nodeAdded(nodeid);
            });

            zwave.on('node ready', function (nodeid, nodeinfo) {
                handler.nodeReady(node, RED, zwave, mqtt, client, nodeid, nodeinfo);
            });

            // first time device detected
            zwave.on('value added', function (nodeid, comclass, value) {
                handler.valueAdded(node, RED, zwave, mqtt, client, nodeid, comclass, value);
            });

            // changed device's state
            zwave.on('value changed', function (nodeid, comclass, value) {
                handler.valueChanged(node, mqtt, nodeid, comclass, value);
            });

            zwave.on('value removed', function (nodeid, comclass, index) {
                handler.valueRemoved(nodeid, comclass, index);
            });

            zwave.on('scene event', function (nodeid, sceneid) {
                handler.sceneEvent(node, mqtt, nodeid, sceneid);
            });

            zwave.on('notification', function (nodeid, notif) {
                handler.notification(node, nodeid, notif);
            });

            zwave.on('scan complete', function () {
                handler.scanComplete(node);
            });

            var zwaveUSB = "/dev/ttyACM0"; // Z-Stick Gen5
            //var zwaveUSB="/dev/ttyUSB0"; // Z-Stick S2

            if (!zwaveConnected) {
                node.status({
                    fill: 'blue',
                    shape: 'dot',
                    text: 'node-red:common.status.connecting'
                });
                zwave.connect(zwaveUSB);
                //subscription(RED, node, zwave);
                zwaveConnected = true;
            } else {
                node.status({
                    fill: 'green',
                    shape: 'ring',
                    text: 'node-red:common.status.connected'
                });
            }

            this.on('close', function () {
                if (zwave && zwaveConnected) {
                    zwave.removeAllListeners();
                    //zwave.disconnect(zwaveUSB);
                    //zwaveConnected = false;
                }
                if (mqtt && mqttConnected) {
                    mqtt.disconnect();
                    mqtt = null;
                    mqttConnected = false;
                }
            });
        }
    }

    RED.nodes.registerType("zwave", zwaveController);
};

// TODO: make a node to activate the inclusion mode
function subscription(RED, node, zwave) {
    var isUtf8 = require('is-utf8');

    var NFCTopic = "smartcard/msgread/#";
    if (node.topic) {
        node.brokerConfig.register(node);
        node.brokerConfig.subscribe(NFCTopic, 2, function (topic, payload, packet) {
            if (isUtf8(payload)) {
                payload = payload.toString();
            }
            try {
                payload = JSON.parse(payload);
            } catch (e) {
            }
            // TODO: this variable will invoke a function which check if the NFC tag have been already passed
            // TODO: like : var existAlready = checkIfExists(payload);
            // TODO: checkIfExists() will return true or false
            var existAlready = false;
            if (!existAlready && payload === "04628662A62780") {
                node.log("Inclusion mode activated !");
                zwave.addNode();
                // TODO: Add this NFC tag to known NFC tags
            }
        }, node.id);
    }
    else {
        node.error(RED._("node-red:mqtt.errors.not-defined"));
    }
    node.on('close', function (done) {
        if (node.brokerConfig) {
            node.brokerConfig.unsubscribe(node.topic, node.id);
            node.brokerConfig.deregister(node, done);
        }
    });
}