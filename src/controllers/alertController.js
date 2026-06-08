const Device = require("../models/deviceModel");
const Organization = require("../models/organizationModel");
const Venue = require("../models/venueModel");

// Get All Alerts by Organization
const getAlertsByOrganization = async (req, res) => {
    try {
        const { organizationId } = req.params;
        const user = req.user;

        if (!organizationId) {
            return res.status(400).json({
                success: false,
                message: "organizationId is required"
            });
        }

        // Permission Check
        if (user.role !== "admin") {
            const org = await Organization.findById(organizationId);
            if (!org || org.owner.toString() !== user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: "You don't have access to this organization"
                });
            }
        }

        // Get all venues in this organization
        const venues = await Venue.find({ organization: organizationId }).select('_id name');

        if (!venues.length) {
            return res.status(200).json({
                success: true,
                message: "No venues found in this organization",
            });
        }

        const venueIds = venues.map(v => v._id);

        // Get all devices in these venues with alerts
        const devicesWithAlerts = await Device.find({
            venue: { $in: venueIds },
            $or: [
                { temperatureAlert: true },
                { humidityAlert: true },
                { odourAlert: true },
                { aqiAlert: true },
                { glAlert: true },
                { voltageAlert: true },
                { currentAlert: true }
            ]
        })
            .populate('venue', 'name')
            .select('deviceId deviceName deviceType category venue temperatureAlert humidityAlert odourAlert aqiAlert glAlert voltageAlert currentAlert espTemperature espHumidity espOdour espAQI espGL espVoltage espCurrent lastUpdateTime');

        const alerts = devicesWithAlerts.map(device => {
            const activeAlerts = [];

            if (device.temperatureAlert) activeAlerts.push({ type: "temperature", value: device.espTemperature });
            if (device.humidityAlert) activeAlerts.push({ type: "humidity", value: device.espHumidity });
            if (device.odourAlert) activeAlerts.push({ type: "odour", value: device.espOdour });
            if (device.aqiAlert) activeAlerts.push({ type: "AQI", value: device.espAQI });
            if (device.glAlert) activeAlerts.push({ type: "gass", value: device.espGL });
            if (device.voltageAlert) activeAlerts.push({ type: "voltage", value: device.espVoltage });
            if (device.currentAlert) activeAlerts.push({ type: "current", value: device.espCurrent });

            return {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                deviceType: device.deviceType,
                category: device.category,
                venue: {
                    id: device.venue._id,
                    name: device.venue.name
                },
                activeAlerts,
                lastUpdateTime: device.lastUpdateTime
            };
        });

        return res.status(200).json({
            success: true,
            organizationId,
            totalDevicesWithAlerts: alerts.length,
            alerts
        });

    } catch (error) {
        console.error("Get Alerts By Organization Error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while fetching alerts"
        });
    }
};

// Get All Alerts by Venue
const getAlertsByVenue = async (req, res) => {
    try {
        const { venueId } = req.params;
        const user = req.user;

        if (!venueId) {
            return res.status(400).json({
                success: false,
                message: "venueId is required"
            });
        }

        // Find venue
        const venue = await Venue.findById(venueId).populate('organization');
        if (!venue) {
            return res.status(404).json({
                success: false,
                message: "Venue not found"
            });
        }

        // Permission Check
        if (user.role !== "admin") {
            const org = venue.organization;
            if (!org || org.owner.toString() !== user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: "You don't have access to this venue"
                });
            }
        }

        // Get all devices in this venue that have any active alerts
        const devicesWithAlerts = await Device.find({
            venue: venueId,
            $or: [
                { temperatureAlert: true },
                { humidityAlert: true },
                { odourAlert: true },
                { aqiAlert: true },
                { glAlert: true },
                { voltageAlert: true },
                { currentAlert: true }
            ]
        })
            .select('deviceId deviceName deviceType category temperatureAlert humidityAlert odourAlert aqiAlert glAlert voltageAlert currentAlert espTemperature espHumidity espOdour espAQI espGL espVoltage espCurrent lastUpdateTime')
            .sort({ lastUpdateTime: -1 });

        const alerts = devicesWithAlerts.map(device => {
            const activeAlerts = [];

            if (device.temperatureAlert) activeAlerts.push({ type: "temperature", value: device.espTemperature });
            if (device.humidityAlert) activeAlerts.push({ type: "humidity", value: device.espHumidity });
            if (device.odourAlert) activeAlerts.push({ type: "odour", value: device.espOdour });
            if (device.aqiAlert) activeAlerts.push({ type: "AQI", value: device.espAQI });
            if (device.glAlert) activeAlerts.push({ type: "gass", value: device.espGL });
            if (device.voltageAlert) activeAlerts.push({ type: "voltage", value: device.espVoltage });
            if (device.currentAlert) activeAlerts.push({ type: "current", value: device.espCurrent });

            return {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                deviceType: device.deviceType,
                category: device.category,
                activeAlerts,
                lastUpdateTime: device.lastUpdateTime
            };
        });

        res.status(200).json({
            success: true,
            venue: {
                id: venue._id,
                name: venue.name
            },
            totalDevicesWithAlerts: alerts.length,
            alerts
        });

    } catch (error) {
        console.error("Get Alerts By Venue Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while fetching venue alerts"
        });
    }
};

module.exports = { getAlertsByOrganization, getAlertsByVenue };