# docker-ami2mqtt
Docker container for Asterisk AMI to MQTT Gateway

Uses Asterisk AMI to read event stream from Asterisk instance and generate
status messages to forward to MQTT broker.

Events tracked:
* Incoming calls from trunks ring -> answer -> hangup
* Outgoing calls on trunks from extensions
* Extension activity for incoming, outgoing and extension to extension calls

are determined by pattern matching numbers. The patterns are defined in config.json.

Asterisk context information is ignored.

Note that calls to pseudo phone extensions can be used to generate automation events.

Status information is determined heuristically. Your mileage will vary.


Inspired by [https://github.com/timothyh/ami-mqtt] and [https://github.com/sgofferj/ami2mqtt]
