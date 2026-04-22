/**
 * Database Service Layer
 * This module handles all communication with Firestore.
 * Currently using a MOCK implementation to allow development without active API keys.
 */

// Mock Data
let mockStudents = [
  { 
    id: '1', 
    name: "Maria Garcia", 
    allergies: "Peanuts, Shellfish", 
    snackAuthorized: true, 
    snackPunches: 8, 
    snackHistory: [], 
    prizePoints: 120, // Initial mock data
    prizeHistory: [
      { id: 'pz_1', reason: 'Participation', points: 10, date: '2026-04-20T10:00:00Z', type: 'earned' }
    ],
    parentId: 'p1', 
    status: 'Active',
    materials: [
      { id: 'm1', name: 'Geometry Basics', subject: 'Mathematics', type: 'pdf', date: '2026-04-20', fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' },
      { id: 'm2', name: 'Irregular Verbs List', subject: 'English', type: 'doc', date: '2026-04-18', fileUrl: '#' },
      { id: 'm3', name: 'Class Notes - Photosynthesis', subject: 'Science', type: 'image', date: '2026-04-15', fileUrl: 'https://images.unsplash.com/photo-1530026405186-ed1f139313ca?w=800' }
    ]
  },
  { 
    id: '2', 
    name: "John Doe", 
    allergies: "None", 
    snackAuthorized: false, 
    snackPunches: 0, 
    snackHistory: [], 
    prizePoints: 45,
    prizeHistory: [],
    parentId: 'p2', 
    status: 'Active',
    materials: [
      { id: 'm4', name: 'Calculus Review', subject: 'Mathematics', type: 'pdf', date: '2026-04-21', fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' }
    ]
  },
  { 
    id: '3', 
    name: "Sofia Ramirez", 
    allergies: "Lactose Intolerant", 
    snackAuthorized: true, 
    snackPunches: 2, 
    snackHistory: [], 
    prizePoints: 0,
    prizeHistory: [],
    parentId: 'p3', 
    status: 'On Hold',
    materials: []
  }
];

let mockSnackCabinet = [
  { id: 'snk_1', name: 'Apple Juice', costPunches: 2, image: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=200&h=200&fit=crop' },
  { id: 'snk_2', name: 'Chocolate Chip Cookie', costPunches: 3, image: 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=200&h=200&fit=crop' },
  { id: 'snk_3', name: 'Potato Chips', costPunches: 3, image: 'https://images.unsplash.com/photo-1566478989037-eade3f7e2bd9?w=200&h=200&fit=crop' },
  { id: 'snk_4', name: 'Granola Bar', costPunches: 2, image: 'https://images.unsplash.com/photo-1622485540306-bc71261a84f3?w=200&h=200&fit=crop' },
  { id: 'snk_5', name: 'Organic Fruit Snacks', costPunches: 1, image: 'https://images.unsplash.com/photo-1582293041079-7814c2f12063?w=200&h=200&fit=crop' }
];

let mockPayments = [
  { id: 'pay_1', studentId: '1', amount: 45.00, type: 'Class Fee', status: 'Paid', date: '2026-04-10' },
  { id: 'pay_2', studentId: '1', amount: 5.00, type: 'Snack Charge', status: 'Pending', date: '2026-04-15' }
];

// Service Methods
export const database = {
  // --- Students ---
  fetchStudents: async () => {
    // Simulate API delay
    return new Promise((resolve) => {
      setTimeout(() => resolve(mockStudents), 500);
    });
  },

  updateStudentHealth: async (studentId, updates) => {
    mockStudents = mockStudents.map(s => s.id === studentId ? { ...s, ...updates } : s);
    return true;
  },

  // --- Snacks & Billing ---
  getSnackCabinet: async () => {
    return Promise.resolve(mockSnackCabinet);
  },

  purchaseSnack: async (studentId, snackId) => {
    const student = mockStudents.find(s => s.id === studentId);
    const snack = mockSnackCabinet.find(s => s.id === snackId);
    
    if (!student || !snack) return false;

    // Allow punches to go negative
    student.snackPunches -= snack.costPunches;
    
    const record = {
      id: `sh_${Date.now()}`,
      date: new Date().toISOString(),
      snackName: snack.name,
      cost: snack.costPunches
    };
    
    if(!student.snackHistory) student.snackHistory = [];
    student.snackHistory.unshift(record); // Add to beginning (most recent)
    
    console.log(`[Database] Purchased ${snack.name} for ${student.name}. Remaining punches: ${student.snackPunches}`);
    return { success: true, newBalance: student.snackPunches };
  },

  logSnackConsumption: async (studentId) => {
    const student = mockStudents.find(s => s.id === studentId);
    if (!student || !student.snackAuthorized) return false;

    const newCharge = {
      id: `pay_${Date.now()}`,
      studentId: studentId,
      amount: 5.00, // Fixed snack price
      type: 'Snack Charge',
      status: 'Pending',
      date: new Date().toISOString().split('T')[0]
    };

    mockPayments.push(newCharge);
    console.log(`[Database] Recorded snack charge for ${student.name}`);
    return true;
  },

  fetchPayments: async (studentId) => {
    return mockPayments.filter(p => p.studentId === studentId);
  },

  // --- Prizes System ---
  awardPrizePoints: async (studentIds, reason, points) => {
    // studentIds is an array of IDs for bulk operations
    const ids = Array.isArray(studentIds) ? studentIds : [studentIds];
    
    ids.forEach(id => {
      const student = mockStudents.find(s => s.id === id);
      if (student) {
        student.prizePoints = (student.prizePoints || 0) + parseInt(points);
        if (!student.prizeHistory) student.prizeHistory = [];
        student.prizeHistory.unshift({
          id: `pz_${Date.now()}_${id}`,
          reason: reason,
          points: parseInt(points),
          date: new Date().toISOString(),
          type: 'earned'
        });
      }
    });
    console.log(`[Database] Awarded ${points} points to ${ids.length} students for: ${reason}`);
    return true;
  },

  redeemPrizePoints: async (studentId, prizeName, cost) => {
    const student = mockStudents.find(s => s.id === studentId);
    if (!student) return { success: false, error: 'Student not found' };
    
    // Check if enough points
    if ((student.prizePoints || 0) < parseInt(cost)) {
      return { success: false, error: 'Insufficient points' };
    }

    student.prizePoints -= parseInt(cost);
    if (!student.prizeHistory) student.prizeHistory = [];
    student.prizeHistory.unshift({
      id: `rz_${Date.now()}`,
      reason: `Redeemed: ${prizeName}`,
      points: -parseInt(cost),
      date: new Date().toISOString(),
      type: 'redeemed'
    });
    
    console.log(`[Database] Student ${student.name} redeemed ${prizeName} for ${cost} points. Remaining: ${student.prizePoints}`);
    return { success: true, newBalance: student.prizePoints };
  },

  // --- Conversations ---
  fetchConversations: async (userId) => {
    // Return mock threads
    return [
      { id: '0', name: "Academy Assistant", lastMsg: "How can I help you?", time: "9:00 AM", unread: 0, roles: ["AI Agent", "Support"], isBot: true },
      { id: '1', name: "Maria Garcia (Student)", parent: "Elena Garcia", lastMsg: "Tomorrow's lesson is at 4pm?", time: "10:30 AM", unread: 2, roles: ["Student", "Parent"] }
    ];
  },

  // --- Student Specific Dashboard Data ---
  fetchStudentData: async (studentId) => {
    return {
      upcomingSessions: [
        { id: 's1', subject: 'English Conversation', teacher: 'Prof. Sarah Jenkins', time: 'Today, 4:00 PM', status: 'upcoming', type: 'Virtual' },
        { id: 's2', subject: 'Mathematics Advanced', teacher: 'Prof. David Brown', time: 'Tomorrow, 10:00 AM', status: 'upcoming', type: 'In-person' },
        { id: 's3', subject: 'History of Arts', teacher: 'Prof. Elena Rodriguez', time: 'Friday, 2:30 PM', status: 'upcoming', type: 'Virtual' }
      ],
      billing: {
        nextPayment: '$120.00',
        dueDate: 'April 25, 2026',
        pendingCharges: [
          { item: 'Snack Log - April 18', amount: '$5.00' }
        ]
      },
      notifications: [
        { id: 1, text: "The Academy will be closed on May 1st.", date: "2 hours ago", type: "info" },
        { id: 2, text: "Your Math class has a new resource available.", date: "5 hours ago", type: "update" }
      ]
    };
  },

  // --- Administrative Billing Data ---
  fetchAdminBillingData: async () => {
    return {
      metrics: {
        expected: "$4,250.00",
        overdue: "$850.00",
        snacks: "$120.00"
      },
      invoices: [
        { id: 'INV-102', student: 'Maria Garcia', parent: 'Elena Garcia', dueDate: 'Apr 25, 2026', tuition: '$120.00', snacks: '$5.00', total: '$125.00', status: 'Pending' },
        { id: 'INV-101', student: 'John Doe', parent: 'Michael Doe', dueDate: 'Apr 10, 2026', tuition: '$400.00', snacks: '$15.00', total: '$415.00', status: 'Overdue' },
        { id: 'INV-100', student: 'Sofia Lee', parent: 'Jennifer Lee', dueDate: 'Apr 18, 2026', tuition: '$80.00', snacks: '$0.00', total: '$80.00', status: 'Paid' }
      ]
    };
  }
};
