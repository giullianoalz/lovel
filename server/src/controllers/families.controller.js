import prisma from '../config/database.js';
import { placeholderUid } from '../services/invite.service.js';

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
                seashells: true,
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
 * Add a member to a family. Either link an existing account (`userId`), or
 * hand `email` + `fullName` to create one on the spot — same shape as
 * scripts/add-family-guardian.js, just reachable from the Directory instead
 * of the command line. New accounts get a placeholder Firebase uid, so they
 * show up as "never invited" until an admin sends the real invite.
 */
export const addFamilyMember = async (req, res, next) => {
  try {
    const { role, isInvoiceRecipient = false } = req.body;
    let { userId } = req.body;

    if (!userId) {
      const email = req.body.email?.trim().toLowerCase();
      const fullName = req.body.fullName?.trim();
      if (!email || !fullName) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'userId, or email and fullName, is required.',
        });
      }

      let user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        // A second membership would silently hand them another household's
        // children and invoices — that's a move, not an add, so it needs a
        // deliberate step this endpoint doesn't take on its own.
        const elsewhere = await prisma.familyMember.findFirst({
          where: { userId: user.id, familyId: { not: req.params.id } },
          include: { family: { select: { name: true } } },
        });
        if (elsewhere) {
          return res.status(409).json({
            error: 'Conflict',
            message: `${user.fullName} already belongs to ${elsewhere.family.name}. Remove them from that family first if they should move here instead.`,
          });
        }
      } else {
        user = await prisma.user.create({
          data: {
            firebaseUid: placeholderUid('import'),
            email,
            fullName,
            phone: req.body.phone?.trim() || null,
            role: 'PARENT',
            status: 'ACTIVE',
          },
        });
      }
      userId = user.id;
    }

    const member = await prisma.familyMember.create({
      data: {
        familyId: req.params.id,
        userId,
        role: role || 'parent',
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
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'This person is already a member of this family.',
      });
    }
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
