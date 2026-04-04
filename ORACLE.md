# Deploy to Oracle Cloud Free Tier

## 1. Create always-free VM

1.  Go to https://www.oracle.com/cloud/free/ and sign in
2.  **Home > Compute > Instances > Create Instance**
3.  **Image:** Oracle Linux 8 or Ubuntu 24.04
4.  **Shape:** VM.Standard.A1.Flex (Ampere ARM, 1-4 OCPUs, up to 24 GB RAM)
    - Use 1 OCPU / 1 GB if only running this bot
5.  **Networking:** Use default VCN, check **Assign a public IPv4 address**
6.  **Add SSH key:** Download the private key (or use your own)
7.  Click **Create**
8.  Note the **Public IP** of the instance

## 2. Open port in Oracle firewall (security list)

1.  **Home > Networking > Virtual Cloud Networks > Your VCN**
2.  Click your **Security List > Add Ingress Rules**
3.  **Destination Port Range:** `3000` (for the health endpoint)
4.  Source CIDR: `0.0.0.0/0`
5.  Click **Add Ingress Rules**

## 3. SSH into the VM

```bash
chmod 400 ~/.ssh/id_rsa        # Set permissions on your private key
ssh -i ~/.ssh/id_rsa ubuntu@<PUBLIC_IP>
```

## 4. Install dependencies on the VM

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install YouTube audio downloader
pip3 install yt-dlp

# (Optional) Check Node version
node --version
npm --version
```

## 5. Install and run the bot

```bash
# Clone your repository
git clone https://github.com/daniel323232/discord-bot.git
cd discord-bot

# Install dependencies
npm install --no-optional

# Create .env file
nano .env
```

Paste into `.env`:
```
DISCORD_TOKEN=your-discord-token
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=anthropic/claude-sonnet-4
YTDLP_PATH=yt-dlp
```

Run:
```bash
npm start &        # runs in background
```

## 6. Keep it running with systemd (recommended)

```bash
sudo nano /etc/systemd/system/discord-bot.service
```

Paste:
```ini
[Unit]
Description=Discord Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/discord-bot
EnvironmentFile=/home/ubuntu/discord-bot/.env
ExecStart=/usr/bin/node bot.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now discord-bot
sudo systemctl status discord-bot   # should show "active (running)"
```

View logs:
```bash
sudo journalctl -u discord-bot -f
```
