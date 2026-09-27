#!/usr/bin/env bash
# Erstinstallation eines frischen Ubuntu-24.04-Servers (z. B. Hetzner Cloud CX22, Standort EU).
# Idempotent. Als root ausfuehren:  bash deploy/hetzner/setup.sh <ssh-benutzer>
set -euo pipefail
USER_NAME="${1:?Benutzername angeben}"

apt-get update
apt-get -y upgrade
apt-get -y install ca-certificates curl git ufw fail2ban unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

# Docker aus dem offiziellen Repository
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# Nicht-root-Benutzer mit SSH-Schluessel des root-Kontos
id -u "$USER_NAME" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$USER_NAME"
usermod -aG docker "$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
[ -f /root/.ssh/authorized_keys ] && install -m 600 -o "$USER_NAME" -g "$USER_NAME" /root/.ssh/authorized_keys "/home/$USER_NAME/.ssh/authorized_keys"

# SSH: nur Schluessel, kein root-Login
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh

# Firewall: nur SSH und HTTPS (80 fuer die Zertifikatsausstellung). Datenbank/Redis/API NICHT offen.
# Hinweis: Docker veroeffentlichte Ports umgehen ufw - deshalb bindet die Compose-Datei alles ausser dem Proxy an 127.0.0.1.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "Fertig. Als $USER_NAME einloggen und deploy/hetzner/README.md ab Schritt 3 folgen."
