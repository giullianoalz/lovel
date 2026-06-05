import prisma from '../config/database.js';

/**
 * GET /api/families
 * List all families with members
 */
export const listFamilies = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;

    const where = {};
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [families, total] = await Promise.all([
      prisma.family.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        orderBy: { name: 'asc' },
        include: {
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  role: true,
                  phone: true,
                  status: true,
                },
              },
            },
          },
          _count: {
            select: {
              invoices: true,
              transactions: true,
            },
          },
        },
      }),
      prisma.family.count({ where }),
    ]);

    res.json({
      families,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/families/:id
 * Get a family with all members and financial summary
 */
export const getFamily = async (req, res, next) => {
  try {
    const family = await prisma.family.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                phone: true,
                status: true,
                snackPunches: true,
                prizePoints: true,
              },
            },
          },
        },
        invoices: {
          orderBy: { date: 'desc' },
          take: 10,
        },
        transactions: {
          orderBy: { date: 'desc' },
          take: 20,
        },
      },
    });

    res.json({ family });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/families
 * Create a new family
 */
export const createFamily = async (req, res, next) => {
  try {
    const { name, tags = [], members = [] } = req.body;

    if (!name) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Family name is required.',
      });
    }

    const family = await prisma.family.create({
      data: {
        name,
        tags,
        members: {
          create: members.map((m) => ({
            userId: m.userId,
            role: m.role || null,
            isInvoiceRecipient: m.isInvoiceRecipient || false,
          })),
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, fullName: true, email: true, role: true },
            },
          },
        },
      },
    });

    res.status(201).json({ message: 'Family created.', family });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/families/:id
 * Update family details
 */
export const updateFamily = async (req, res, next) => {
  try {
    const { name, tags } = req.body;

    const family = await prisma.family.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(tags && { tags }),
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, fullName: true, email: true, role: true },
            },
          },
        },
      },
    });

    res.json({ message: 'Family updated.', family });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/families/:id/members
 * Add a member to a family
 */
export const addFamilyMember = async (req, res, next) => {
  try {
    const { userId, role, isInvoiceRecipient = false } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'userId is required.',
      });
    }

    const member = await prisma.familyMember.create({
      data: {
        familyId: req.params.id,
        userId,
        role,
        isInvoiceRecipient,
      },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, role: true },
        },
        family: true,
      },
    });

    res.status(201).json({ message: 'Member added to family.', member });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/families/:id/members/:memberId
 * Remove a member from a family
 */
export const removeFamilyMember = async (req, res, next) => {
  try {
    await prisma.familyMember.delete({
      where: { id: req.params.memberId },
    });

    res.json({ message: 'Member removed from family.' });
  } catch (error) {
    next(error);
  }
};
