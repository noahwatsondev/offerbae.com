#!/bin/bash
pkill -9 node
nohup npm start >> server.log 2>&1 &
echo "RESTART SCRIPT FINISHED"
