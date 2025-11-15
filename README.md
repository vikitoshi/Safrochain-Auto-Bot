# Safrochain Auto Bot

A simple CLI bot for automating tasks on the Safrochain testnet (Send, Stake, Claim, Unstake).

**Disclaimer:** This software is for **testnet use only**.Use at your own risk.

---

## 🚀 Setup

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/vikitoshi/Safrochain-Auto-Bot.git](https://github.com/vikitoshi/Safrochain-Auto-Bot.git)
    cd Safrochain-Auto-Bot
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

---

## ⚙️ Configuration

Create these files in the project's root directory:

1.  **`.env` (Required)**
    * Used to store your wallets.
    * **Format:**
        ```env
        MNEMONIC_1=word gentle ...
        MNEMONIC_2=another one ...
        PRIVATE_KEY_1=abcdef123456... (64 hex characters)
        ```

2.  **`proxies.txt` (Optional)**
    * Used to load proxies for network requests.
    * **Format:** (One per line)
        ```
        http://ip:port
        http://user:pass@ip:port
        ```

---

## ▶️ Run

Start the bot with this command. It will load your wallets and display an interactive menu.

```bash
node index.js
