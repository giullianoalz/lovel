import { getAcademySettings, updateAcademySettings } from '../services/settings.service.js';

// GET /api/settings/notifications
export const getNotificationSettings = async (req, res, next) => {
  try {
    const settings = await getAcademySettings();
    res.json({ settings });
  } catch (error) {
    next(error);
  }
};

// PUT /api/settings/notifications
export const putNotificationSettings = async (req, res, next) => {
  try {
    const { classReminderEnabled, classReminderMinutesBefore, absenceAlertEnabled } = req.body;

    const data = {};
    if (classReminderEnabled !== undefined) data.classReminderEnabled = !!classReminderEnabled;
    if (absenceAlertEnabled !== undefined) data.absenceAlertEnabled = !!absenceAlertEnabled;
    if (classReminderMinutesBefore !== undefined) {
      const minutes = parseInt(classReminderMinutesBefore);
      if (isNaN(minutes) || minutes < 1 || minutes > 180) {
        return res.status(400).json({ error: 'Validation Error', message: 'classReminderMinutesBefore must be between 1 and 180.' });
      }
      data.classReminderMinutesBefore = minutes;
    }

    const settings = await updateAcademySettings(data, req.user.id);
    res.json({ message: 'Settings updated.', settings });
  } catch (error) {
    next(error);
  }
};
