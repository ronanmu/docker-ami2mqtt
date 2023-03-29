# docker-ami2mqtt
Docker container for Asterisk AMI to MQTT Gateway

Uses Asterisk AMI to read event stream from Asterisk instance and generate
status messages to forward to MQTT broker.

Events tracked:
* Incoming calls from trunks ring -> answer -> hangup
* Outgoing calls on trunks from extensions
* Extension activity for incoming, outgoing and extension to extension calls

Asterisk context information is ignored.

Note that calls to pseudo phone extensions can be used to generate automation events.

## Usage

### docker-compose

```yaml
---
version: "2.1"
services:
  ami2mqtt:
    image: ronanmu/ami2mqtt:latest
    environment:
      - AMI_HOST=asterisk
      - AMI_PORT=5038
      - AMI_USERNAME=asterisk
      - AMI_PASSWORD=manager
      - MQTT_HOST=mosquitto
      - MQTT_PORT=1883
      - MQTT_USERNAME=mqttuser
      - MQTT_PASSWORD=mqttpass
      - MQTT_KEEPALIVE=60
      - MQTT_PREFIX=pbx
    restart: unless-stopped
```

## Parameters

| Parameter | Function | Default |
| :----: | --- | --- |
| `AMI_HOST` | hostname of Asterisk Manager instance | `asterisk` |
| `AMI_PORT` | AMI port number | `5038` |
| `AMI_USERNAME` | AMI username | `asterisk` |
| `AMI_PASSWORD` | AMI password | `manager` |
| `MQTT_HOST` | hostname of MQTT server | `mosquitto` |
| `MQTT_PORT` | port of MQTT server | `1883` |
| `MQTT_USERNAME` | username for MQTT server | <none> |
| `MQTT_PASSWORD` | password for MQTT server | <none> |
| `MQTT_KEEPALIVE` | keep alive time out for MQTT server | 60 |
| `MQTT_PREFIX` | prefix for topics for MQTT server | `pbx` |




Inspired by [https://github.com/timothyh/ami-mqtt] and [https://github.com/sgofferj/ami2mqtt]
