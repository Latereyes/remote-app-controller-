#!/data/data/com.termux/files/usr/bin/sh
# Avvio automatico con Termux:Boot: copia questo file in ~/.termux/boot/
termux-wake-lock
cd "$HOME/remote-app-controller/relay" || exit 1
while true; do
  python wol_relay.py >> relay.log 2>&1
  sleep 5
done
