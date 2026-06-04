const express = require('express');
const cors = require('cors');
const { TonClient, WalletContractV4, internal } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');

const app = express();
app.use(cors());
app.use(express.json());

const MNEMONIC = process.env.MNEMONIC;
if (!MNEMONIC) { console.error("❌ Set MNEMONIC environment variable"); process.exit(1); }

const JETTON_MASTER = "EQD8LA28Gelt6BB4DgD5XWmq8dhGtKBbt4wPfaDE2S1BySV";
const RATE = 100;
const processed = new Set();

const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC' });

async function getJettonWalletAddress(userAddress, jettonMaster) {
    // вычисление jetton wallet адреса для пользователя
    const { Address, JettonMaster } = require('@ton/ton');
    const userAddr = Address.parse(userAddress);
    const master = Address.parse(jettonMaster);
    const jettonWalletAddress = await JettonMaster.getJettonWalletAddress(master, userAddr);
    return jettonWalletAddress.toString();
}

async function sendGKOALA(toAddress, amountTokens) {
    const key = await mnemonicToPrivateKey(MNEMONIC.split(' '));
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
    const contract = client.open(wallet);
    const senderAddress = wallet.address.toString();
    
    const jettonWalletFrom = await getJettonWalletAddress(senderAddress, JETTON_MASTER);
    const jettonWalletTo = await getJettonWalletAddress(toAddress, JETTON_MASTER);
    
    const amountNano = amountTokens * 1e9; // допущение: 1 GKOALA = 1e9 nano, уточни decimals
    
    const transferPayload = {
        $$type: 'Transfer',
        query_id: 0n,
        amount: BigInt(amountNano),
        destination: Address.parse(jettonWalletTo),
        response_destination: Address.parse(senderAddress),
        custom_payload: null,
        forward_ton_amount: 0n,
        forward_payload: null
    };
    
    const seqno = await contract.getSeqno();
    const transfer = await contract.createTransfer({
        seqno,
        secretKey: key.secretKey,
        messages: [internal({
            to: jettonWalletFrom,
            value: '0.05', // комиссия за перевод Jetton
            body: transferPayload,
            bounce: true
        })]
    });
    await client.sendExternalMessage(transfer);
    return transfer.hash().toString('hex');
}

app.post('/api/redeem', async (req, res) => {
    const { wallet, leaves } = req.body;
    if (!wallet || !leaves) return res.status(400).json({ error: 'Missing data' });
    if (processed.has(wallet)) return res.status(400).json({ error: 'Already claimed' });
    const tokens = Math.floor(leaves / RATE);
    if (tokens < 1) return res.status(400).json({ error: `Need ${RATE} leaves` });
    try {
        const txId = await sendGKOALA(wallet, tokens);
        processed.add(wallet);
        res.json({ success: true, txId, tokens });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
