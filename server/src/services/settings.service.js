import prisma from '../config/database.js';

// Fixed id so concurrent callers race-safely converge on the same row via
// upsert instead of accidentally creating two "singleton" settings rows.
const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

export const getAcademySettings = async () => {
  return prisma.academySettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
};

export const updateAcademySettings = async (data, updatedById) => {
  return prisma.academySettings.upsert({
    where: { id: SETTINGS_ID },
    update: { ...data, updatedById },
    create: { id: SETTINGS_ID, ...data, updatedById },
  });
};
