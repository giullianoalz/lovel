import {
  getAllEventConfigs,
  updateEventConfig,
} from '../services/notificationConfig.service.js';

// GET /api/settings/notifications
// Returns the fully-resolved per-event config for every notification event,
// including each event's label/description, allowed audiences, and param schema
// so the admin UI can render itself generically.
export const getNotificationSettings = async (req, res, next) => {
  try {
    const events = await getAllEventConfigs();
    res.json({ events });
  } catch (error) {
    next(error);
  }
};

// PUT /api/settings/notifications
// Body: { events: [ { key, enabled?, audience?, params? }, ... ] }
// Validates and persists each event's overrides, then returns the refreshed set.
export const putNotificationSettings = async (req, res, next) => {
  try {
    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'Validation Error', message: 'events array is required.' });
    }

    for (const evt of events) {
      if (!evt || typeof evt.key !== 'string') {
        return res.status(400).json({ error: 'Validation Error', message: 'Each event needs a key.' });
      }
      await updateEventConfig(evt.key, evt, req.user.id);
    }

    const refreshed = await getAllEventConfigs();
    res.json({ message: 'Settings updated.', events: refreshed });
  } catch (error) {
    // Service throws { status, message } for validation failures.
    if (error && error.status) {
      return res.status(error.status).json({ error: 'Validation Error', message: error.message });
    }
    next(error);
  }
};
