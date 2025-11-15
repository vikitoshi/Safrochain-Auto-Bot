require('dotenv').config();
const axios = require('axios');
const readline = require('readline');
const fs = require('fs').promises;
const { DirectSecp256k1HdWallet, DirectSecp256k1Wallet } = require('@cosmjs/proto-signing');
const { SigningStargateClient, GasPrice } = require('@cosmjs/stargate');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
  magenta: '\x1b[35m',
};

const logger = {
  info: (m) => console.log(`${colors.white}[➤] ${m}${colors.reset}`),
  warn: (m) => console.log(`${colors.yellow}[⚠] ${m}${colors.reset}`),
  error: (m) => console.log(`${colors.red}[✗] ${m}${colors.reset}`),
  success: (m) => console.log(`${colors.green}[✅] ${m}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[→] ${msg}${colors.reset}`),
  step: (m) => console.log(`\n${colors.cyan}${colors.bold}[➤] ${m}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(` Safrochain Auto Bot - Airdrop Insiders      `);
    console.log(`---------------------------------------------${colors.reset}\n`);
  },
};

const CONFIG = {
  FAUCET_API: 'https://phqtdczpawzuvdpbxarn.supabase.co/functions/v1/safro-transaction',
  HUB_API: 'https://api-safrochainhub.safrochain.com/api/v1',
  RPC_ENDPOINT: 'https://rpc.testnet.safrochain.com',
  REST_ENDPOINT: 'https://rest.testnet.safrochain.com',
  CHAIN_ID: 'safro-testnet-1',
  DENOM: 'usaf',
  GAS_PRICE: '0.3usaf',
  FAUCET_APIKEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBocXRkY3pwYXd6dXZkcGJ4YXJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUxODI0OTMsImV4cCI6MjA2MDc1ODQ5M30.khlMFI2z55h7FvYeYt7Nm0gU8Bm9W5vehqVNG6a5HjA',
};

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.currentIndex = 0;
  }

  async loadProxies() {
    try {
      const data = await fs.readFile('proxies.txt', 'utf-8');
      this.proxies = data
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      if (this.proxies.length > 0) {
        logger.info(`Loaded ${this.proxies.length} proxies`);
      } else {
        logger.info('Loaded proxies: 0 (no proxies configured)');
      }
    } catch (error) {
      logger.warn('No proxies.txt file found or error loading proxies');
    }
  }

  getNextProxy() {
    if (this.proxies.length === 0) return null;

    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;

    if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
      return proxy;
    } else if (proxy.includes('@')) {
      return `http://${proxy}`;
    } else {
      return `http://${proxy}`;
    }
  }

  getAxiosConfig() {
    const proxyUrl = this.getNextProxy();
    if (!proxyUrl) return {};

    try {
      return {
        httpsAgent: new HttpsProxyAgent(proxyUrl),
        proxy: false,
      };
    } catch (error) {
      logger.warn(`Invalid proxy format: ${proxyUrl}`);
      return {};
    }
  }
}

class SafrochainBot {
  constructor() {
    this.proxyManager = new ProxyManager();
    this.wallets = [];
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async initialize() {
    await this.proxyManager.loadProxies();
    await this.loadWallets();
  }

  async loadWallets() {
    const envKeys = Object.keys(process.env);

    const mnemonicKeys = envKeys.filter(k => k.startsWith('MNEMONIC_'));
    for (const key of mnemonicKeys) {
      const mnemonic = process.env[key];
      if (mnemonic && mnemonic.trim()) {
        try {
          const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic.trim(), {
            prefix: 'addr_safro',
          });
          const [account] = await wallet.getAccounts();
          this.wallets.push({
            wallet,
            address: account.address,
            mnemonic: mnemonic.trim(),
            type: 'mnemonic',
            source: key,
          });
        } catch (error) {
          logger.error(`Failed to load ${key}: ${error.message}`);
        }
      }
    }

    const privateKeyKeys = envKeys.filter(k => k.startsWith('PRIVATE_KEY_'));
    for (const key of privateKeyKeys) {
      const privateKey = process.env[key];
      if (privateKey && privateKey.trim()) {
        try {
          const cleanPrivateKey = privateKey.trim().replace(/^0x/, '');

          if (!/^[0-9a-fA-F]+$/.test(cleanPrivateKey)) {
            throw new Error('Private key contains invalid characters (must be hex: 0-9, a-f)');
          }

          if (cleanPrivateKey.length !== 64) {
            throw new Error(`Private key must be 64 hex characters, got ${cleanPrivateKey.length}`);
          }

          const privateKeyBytes = Uint8Array.from(Buffer.from(cleanPrivateKey, 'hex'));

          const wallet = await DirectSecp256k1Wallet.fromKey(privateKeyBytes, 'addr_safro');
          const [account] = await wallet.getAccounts();

          this.wallets.push({
            wallet,
            address: account.address,
            privateKey: cleanPrivateKey,
            type: 'privateKey',
            source: key,
          });

        } catch (error) {
          logger.error(`Failed to load ${key}: ${error.message}`);
        }
      }
    }

    if (this.wallets.length === 0) {
      logger.warn('No wallets found in .env file');
      logger.info('Please add MNEMONIC_1, MNEMONIC_2, ... or PRIVATE_KEY_1, PRIVATE_KEY_2, ... to your .env file');
    } else {
      logger.success(`Total wallets loaded: ${this.wallets.length}`);
    }
  }

  async question(prompt) {
    return new Promise(resolve => this.rl.question(prompt, resolve));
  }

  async generateWallet() {
    const wallet = await DirectSecp256k1HdWallet.generate(24, {
      prefix: 'addr_safro',
    });
    const [account] = await wallet.getAccounts();

    const mnemonic = wallet.mnemonic || '*** hidden ***';

    return {
      wallet,
      address: account.address,
      mnemonic,
      privateKey: null,
    };
  }

  async saveWalletToFile(walletData) {
    const timestamp = new Date().toISOString();
    const data = `
===========================================
Created: ${timestamp}
Address: ${walletData.address}
Mnemonic: ${walletData.mnemonic}
Private Key: ${walletData.privateKey || 'N/A'}
===========================================

`;
    await fs.appendFile('new_wallets.txt', data);
  }

  async getBalance(address) {
    try {
      const axiosConfig = this.proxyManager.getAxiosConfig();
      const response = await axios.get(
        `${CONFIG.REST_ENDPOINT}/cosmos/bank/v1beta1/balances/${address}`,
        axiosConfig
      );

      const balance = response.data.balances.find(b => b.denom === CONFIG.DENOM);
      return balance ? parseInt(balance.amount) / 1000000 : 0;
    } catch (error) {
      logger.error(`Failed to get balance: ${error.message}`);
      return 0;
    }
  }

  async sendTokens(fromWallet, toAddress, amount) {
    try {
      logger.loading(`Sending ${amount} SAF to ${toAddress}...`);

      const client = await SigningStargateClient.connectWithSigner(
        CONFIG.RPC_ENDPOINT,
        fromWallet.wallet,
        { gasPrice: GasPrice.fromString(CONFIG.GAS_PRICE) }
      );

      const amountInUsaf = Math.floor(amount * 1000000);
      const result = await client.sendTokens(
        fromWallet.address,
        toAddress,
        [{ denom: CONFIG.DENOM, amount: amountInUsaf.toString() }],
        'auto',
        'Sent from Safrochain Bot'
      );

      logger.success(`Sent ${amount} SAF - TxHash: ${result.transactionHash}`);
      return result;
    } catch (error) {
      logger.error(`Send tokens error: ${error.message}`);
      return null;
    }
  }

  async getValidators() {
    try {
      const axiosConfig = this.proxyManager.getAxiosConfig();
      const response = await axios.get(
        `${CONFIG.REST_ENDPOINT}/cosmos/staking/v1beta1/validators`,
        axiosConfig
      );

      return response.data.validators.filter(
        v => !v.jailed && v.status === 'BOND_STATUS_BONDED'
      );
    } catch (error) {
      logger.error(`Failed to get validators: ${error.message}`);
      return [];
    }
  }

  async stakeTokens(wallet, validatorAddress, amount) {
    try {
      logger.loading(`Staking ${amount} SAF to ${validatorAddress}...`);

      const client = await SigningStargateClient.connectWithSigner(
        CONFIG.RPC_ENDPOINT,
        wallet.wallet,
        { gasPrice: GasPrice.fromString(CONFIG.GAS_PRICE) }
      );

      const amountInUsaf = Math.floor(amount * 1000000);
      const msg = {
        typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
        value: {
          delegatorAddress: wallet.address,
          validatorAddress: validatorAddress,
          amount: { denom: CONFIG.DENOM, amount: amountInUsaf.toString() },
        },
      };

      const result = await client.signAndBroadcast(
        wallet.address,
        [msg],
        'auto',
        'Delegating tokens from Safrochain Bot'
      );

      logger.success(`Staked ${amount} SAF - TxHash: ${result.transactionHash}`);
      return result;
    } catch (error) {
      logger.error(`Stake error: ${error.message}`);
      return null;
    }
  }

  async unstakeTokens(wallet, validatorAddress, amount) {
    try {
      logger.loading(`Unstaking ${amount} SAF from ${validatorAddress}...`);

      const client = await SigningStargateClient.connectWithSigner(
        CONFIG.RPC_ENDPOINT,
        wallet.wallet,
        { gasPrice: GasPrice.fromString(CONFIG.GAS_PRICE) }
      );

      const amountInUsaf = Math.floor(amount * 1000000);
      const msg = {
        typeUrl: '/cosmos.staking.v1beta1.MsgUndelegate',
        value: {
          delegatorAddress: wallet.address,
          validatorAddress,
          amount: {
            denom: CONFIG.DENOM,
            amount: amountInUsaf.toString(),
          },
        },
      };

      const result = await client.signAndBroadcast(
        wallet.address,
        [msg],
        'auto',
        'Undelegating tokens'
      );

      logger.success(`Unstaked ${amount} SAF - TxHash: ${result.transactionHash}`);
      return result;
    } catch (error) {
      logger.error(`Unstake error: ${error.message}`);
      return null;
    }
  }

  async getStakingRewards(address) {
    try {
      const axiosConfig = this.proxyManager.getAxiosConfig();
      const response = await axios.get(
        `${CONFIG.REST_ENDPOINT}/cosmos/distribution/v1beta1/delegators/${address}/rewards`,
        axiosConfig
      );
      return response.data;
    } catch (error) {
      logger.error(`Failed to get staking rewards: ${error.message}`);
      return null;
    }
  }

  async claimStakingRewards(wallet, validatorAddresses = []) {
    try {
      const client = await SigningStargateClient.connectWithSigner(
        CONFIG.RPC_ENDPOINT,
        wallet.wallet,
        { gasPrice: GasPrice.fromString(CONFIG.GAS_PRICE) }
      );

      const msgs = validatorAddresses.map(vAddr => ({
        typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
        value: {
          delegatorAddress: wallet.address,
          validatorAddress: vAddr,
        },
      }));

      if (msgs.length === 0) {
        logger.warn('No reward messages to claim');
        return null;
      }

      logger.loading(`Claiming staking rewards for ${wallet.address} (${msgs.length} validator(s))...`);

      const result = await client.signAndBroadcast(
        wallet.address,
        msgs,
        'auto',
        'Claiming all staking rewards'
      );

      logger.success(`Claim rewards tx sent - TxHash: ${result.transactionHash}`);
      return result;
    } catch (error) {
      logger.error(`Claim rewards error: ${error.message}`);
      return null;
    }
  }

  async connectToHub(address) {
    try {
      const axiosConfig = this.proxyManager.getAxiosConfig();
      const response = await axios.post(
        `${CONFIG.HUB_API}/auth`,
        { address },
        {
          headers: { 'Content-Type': 'application/json' },
          ...axiosConfig,
        }
      );

      if (response.data.status) {
        return response.data.data.token.token;
      }
      return null;
    } catch (error) {
      logger.error(`Hub connection error: ${error.message}`);
      return null;
    }
  }

  async getUserProfile(token) {
    try {
      const axiosConfig = this.proxyManager.getAxiosConfig();
      const response = await axios.get(
        `${CONFIG.HUB_API}/me`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          ...axiosConfig,
        }
      );

      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch user profile: ${error.message}`);
      return null;
    }
  }

  async showUserSummary() {
    if (this.wallets.length === 0) {
      logger.warn('No wallets available for user info');
      console.log('');
      return;
    }

    const wallet = this.wallets[0];

    const token = await this.connectToHub(wallet.address);
    if (!token) {
      logger.error('Failed to connect to hub for user info');
      console.log('');
      return;
    }

    const profile = await this.getUserProfile(token);
    if (!profile || !profile.status || !profile.data) {
      logger.error('Failed to get user info from /me endpoint');
      console.log('');
      return;
    }

    const data = profile.data;

    console.log('');
    logger.info(`Address : ${data.address}`);
    logger.info(`Points  : ${data.point}`);
    logger.info(`Is Active : ${data.is_active ? 'true' : 'false'}`);
  }

  async sendOneSafToThirtyRandom(wallet) {
    const balance = await this.getBalance(wallet.address);
    const needed = 30 * 1 + 1;

    if (balance < needed) {
      logger.error(
        `Insufficient balance for 30x 1 SAF sends. Need at least ~${needed} SAF, have ${balance} SAF`
      );
      return false;
    }

    logger.info('Sending 1 SAF to 30 random addresses...');

    for (let i = 0; i < 30; i++) {
      const randomWallet = await this.generateWallet();
      const toAddress = randomWallet.address;

      logger.loading(`[${i + 1}/30] Sending 1 SAF to ${toAddress}...`);
      const result = await this.sendTokens(wallet, toAddress, 1);

      if (!result) {
        logger.warn(`[${i + 1}/30] Send failed, continuing...`);
      }

      if (i < 29) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    logger.success('Completed sending 1 SAF to 30 random addresses.');
    return true;
  }

  async handleSendTokens() {
    logger.step('Send SAF Tokens');

    if (this.wallets.length === 0) {
      logger.error('No wallets available');
      return;
    }

    const wallet = this.wallets[0];
    logger.info(`Using source wallet: ${wallet.address}`);

    const balance = await this.getBalance(wallet.address);
    logger.info(`Current balance: ${balance} SAF`);

    console.log(`\n${colors.cyan}Send SAF Sub Menu:${colors.reset}`);
    console.log('1. Send to specified address');
    console.log('2. Send to random address');
    console.log('3. Send 1 SAF to 30 random addresses (single run)');

    const sendType = await this.question('\nSelect send type (1-3): ');

    if (sendType === '1') {
      const toAddress = await this.question('Enter recipient address: ');
      if (!toAddress.startsWith('addr_safro')) {
        logger.error('Invalid Safrochain address');
        return;
      }

      const amountInput = await this.question('Enter amount to send (SAF): ');
      const sendAmount = parseFloat(amountInput);

      if (isNaN(sendAmount) || sendAmount <= 0) {
        logger.error('Invalid amount');
        return;
      }

      if (sendAmount > balance - 0.5) {
        logger.error('Not enough balance (need to leave some SAF for gas)');
        return;
      }

      await this.sendTokens(wallet, toAddress, sendAmount);
    } else if (sendType === '2') {
      const amountInput = await this.question('Enter amount to send (SAF): ');
      const sendAmount = parseFloat(amountInput);

      if (isNaN(sendAmount) || sendAmount <= 0) {
        logger.error('Invalid amount');
        return;
      }

      if (sendAmount > balance - 0.5) {
        logger.error('Not enough balance (need to leave some SAF for gas)');
        return;
      }

      const randomWallet = await this.generateWallet();
      const toAddress = randomWallet.address;
      logger.info(`Generated random address: ${toAddress}`);

      await this.sendTokens(wallet, toAddress, sendAmount);
    } else if (sendType === '3') {
      await this.sendOneSafToThirtyRandom(wallet);
    } else {
      logger.error('Invalid send type');
    }
  }

  async handleStakeTokens() {
    logger.step('Stake SAF Tokens');

    if (this.wallets.length === 0) {
      logger.error('No wallets available');
      return;
    }

    const stakeInput = await this.question('Enter stake amount per wallet (SAF): ');
    const stakeAmount = parseFloat(stakeInput);

    if (isNaN(stakeAmount) || stakeAmount <= 0) {
      logger.error('Invalid stake amount');
      return;
    }

    const validators = await this.getValidators();
    if (validators.length === 0) {
      logger.error('No active validators found');
      return;
    }

    logger.info(`Found ${validators.length} active validators`);

    for (const wallet of this.wallets) {
      logger.info(`Processing wallet: ${wallet.address}`);

      const balance = await this.getBalance(wallet.address);
      logger.info(`Balance: ${balance} SAF`);

      if (balance < stakeAmount + 0.5) {
        logger.warn(`Insufficient balance to stake ${stakeAmount} SAF (need buffer for gas)`);
        continue;
      }

      const randomValidator =
        validators[Math.floor(Math.random() * validators.length)];
      logger.info(`Selected validator: ${randomValidator.description.moniker} (${randomValidator.operator_address})`);

      await this.stakeTokens(wallet, randomValidator.operator_address, stakeAmount);

      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  async handleClaimStakingRewards() {
    logger.step('Claim Staking Rewards');

    if (this.wallets.length === 0) {
      logger.error('No wallets available');
      return;
    }

    for (let i = 0; i < this.wallets.length; i++) {
      const wallet = this.wallets[i];
      logger.info(`[${i + 1}/${this.wallets.length}] Processing wallet: ${wallet.address}`);

      const rewardsData = await this.getStakingRewards(wallet.address);
      if (!rewardsData) {
        logger.warn('Failed to fetch rewards data');
        continue;
      }

      if (!rewardsData.rewards || rewardsData.rewards.length === 0) {
        logger.warn('No staking rewards found for this wallet');
        continue;
      }

      const totalReward = rewardsData.total?.find(t => t.denom === CONFIG.DENOM);
      const totalSaf = totalReward ? parseFloat(totalReward.amount) / 1000000 : 0;

      logger.info(`Total rewards: ${totalSaf} SAF`);

      const validatorAddresses = rewardsData.rewards.map(r => r.validator_address);
      await this.claimStakingRewards(wallet, validatorAddresses);

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    logger.success('Finished claiming staking rewards for all wallets.');
  }

  async handleUnstakeTokens() {
    logger.step('Unstake SAF Tokens');

    if (this.wallets.length === 0) {
      logger.error('No wallets available');
      return;
    }

    console.log('\nAvailable wallets:');
    this.wallets.forEach((w, i) => {
      const typeLabel = w.type === 'mnemonic' ? '(Mnemonic)' : '(Private Key)';
      console.log(`${i + 1}. ${w.address} ${typeLabel}`);
    });

    const walletIdxInput = await this.question('\nSelect wallet number for unstake: ');
    const walletIdx = parseInt(walletIdxInput) - 1;

    if (walletIdx < 0 || walletIdx >= this.wallets.length) {
      logger.error('Invalid wallet selection');
      return;
    }

    const wallet = this.wallets[walletIdx];
    logger.info(`Selected wallet: ${wallet.address}`);

    try {
      const axiosConfig = this.proxyManager.getAxiosConfig();
      const delegRes = await axios.get(
        `${CONFIG.REST_ENDPOINT}/cosmos/staking/v1beta1/delegations/${wallet.address}`,
        axiosConfig
      );

      const delegations = delegRes.data.delegation_responses || [];
      if (delegations.length === 0) {
        logger.warn('No active delegations found for this wallet');
        return;
      }

      const validators = await this.getValidators();
      const vMap = {};
      validators.forEach(v => {
        vMap[v.operator_address] = v.description.moniker;
      });

      console.log(`\n${colors.cyan}Active delegations:${colors.reset}`);
      delegations.forEach((d, idx) => {
        const vAddr = d.delegation.validator_address;
        const moniker = vMap[vAddr] || 'Unknown';
        const amountSaf = parseFloat(d.balance.amount) / 1000000;
        console.log(
          `${idx + 1}. Validator: ${vAddr} (${moniker}) | Delegated: ${amountSaf} SAF`
        );
      });

      const valIdxInput = await this.question('\nSelect validator number to unstake from: ');
      const valIdx = parseInt(valIdxInput) - 1;

      if (valIdx < 0 || valIdx >= delegations.length) {
        logger.error('Invalid validator selection');
        return;
      }

      const selectedDelegation = delegations[valIdx];
      const validatorAddress = selectedDelegation.delegation.validator_address;
      const delegatedAmountSaf = parseFloat(selectedDelegation.balance.amount) / 1000000;

      logger.info(
        `Selected validator: ${validatorAddress} | Delegated: ${delegatedAmountSaf} SAF`
      );

      const unstakeInput = await this.question('Enter amount to unstake (SAF): ');
      const unstakeAmount = parseFloat(unstakeInput);

      if (isNaN(unstakeAmount) || unstakeAmount <= 0) {
        logger.error('Invalid unstake amount');
        return;
      }

      if (unstakeAmount > delegatedAmountSaf) {
        logger.error('Unstake amount is greater than delegated amount');
        return;
      }

      await this.unstakeTokens(wallet, validatorAddress, unstakeAmount);
    } catch (error) {
      logger.error(`Failed to fetch delegations: ${error.message}`);
    }
  }

  async showMenu() {
    console.log(`\n${colors.cyan}${colors.bold}=== MAIN MENU ===${colors.reset}`);
    console.log('1. Send SAF Tokens');
    console.log('2. Stake SAF Tokens');
    console.log('3. Claim Staking Rewards');
    console.log('4. Unstake SAF Tokens');
    console.log('5. Exit');

    const choice = await this.question('\nSelect option: ');

    switch (choice) {
      case '1':
        await this.handleSendTokens();
        break;
      case '2':
        await this.handleStakeTokens();
        break;
      case '3':
        await this.handleClaimStakingRewards();
        break;
      case '4':
        await this.handleUnstakeTokens();
        break;
      case '5':
        logger.info('Goodbye!');
        this.rl.close();
        process.exit(0);
      default:
        logger.error('Invalid option');
    }

    await this.showMenu();
  }

  async run() {
    logger.banner();
    await this.initialize();
    await this.showUserSummary();
    await this.showMenu();
  }
}

const bot = new SafrochainBot();
bot.run().catch(error => {
  logger.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
