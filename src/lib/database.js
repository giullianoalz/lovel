/**
 * Database Service Layer
 * This module handles all communication with Firestore.
 * Currently using a MOCK implementation to allow development without active API keys.
 */

// Mock Data
let mockStudents = [
  { id: '1', name: "Maria Garcia", allergies: "Peanuts, Shellfish", snackAuthorized: true, parentId: 'p1', status: 'Active' },
  { id: '2', name: "John Doe", allergies: "None", snackAuthorized: false, parentId: 'p2', status: 'Active' },
  { id: '3', name: "Sofia Ramirez", allergies: "Lactose Intolerant", snackAuthorized: true, parentId: 'p3', status: 'On Hold' }
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
