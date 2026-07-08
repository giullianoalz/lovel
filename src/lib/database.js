import api from './api';

/**
 * Database Service Layer
 * This module handles all communication with the backend.
 * Currently migrating to use the real API instead of Mock Data.
 */

// Mock Data
let mockFamilies = [
  { 
    id: 'f1', 
    name: 'Garcia Family', 
    contacts: [{ name: 'Elena Garcia', role: 'Mother', isInvoiceRecipient: true }], 
    tags: ['EMA', 'Fall 2025'] 
  },
  { 
    id: 'f2', 
    name: 'Doe Family', 
    contacts: [{ name: 'Michael Doe', role: 'Father', isInvoiceRecipient: true }], 
    tags: ['Love Learning FL LLC'] 
  },
  { 
    id: 'f3', 
    name: 'Ramirez Family', 
    contacts: [{ name: 'Carlos Ramirez', role: 'Father', isInvoiceRecipient: true }], 
    tags: [] 
  }
];

let mockStudents = [
  { 
    id: '1', 
    name: "Maria Garcia", 
    age: 12,
    parentName: "Elena Garcia",
    parentPhone: "(555) 123-4567",
    parentEmail: "elena.garcia@example.com",
    allergies: "Peanuts, Shellfish", 
    snackAuthorized: true, 
    snackPunches: 8, 
    snackHistory: [], 
    seashells: 120, // Initial mock data
    seashellHistory: [
      { id: 'pz_1', reason: 'Participation', points: 10, date: '2026-04-20T10:00:00Z', type: 'earned' }
    ],
    familyId: 'f1', 
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
    age: 15,
    parentName: "Michael Doe",
    parentPhone: "(555) 987-6543",
    parentEmail: "michael.doe@example.com",
    allergies: "None", 
    snackAuthorized: false, 
    snackPunches: 0, 
    snackHistory: [], 
    seashells: 45,
    seashellHistory: [],
    familyId: 'f2', 
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
    seashells: 0,
    seashellHistory: [],
    familyId: 'f3', 
    status: 'Inactive',
    materials: []
  }
];

let mockTransactions = [
  { id: 'tx_1', studentId: '1', familyId: 'f1', amount: 50.00, type: 'Charge', description: 'In Person Tutoring with Prof. David Brown', date: '2026-04-20', invoiceId: null },
  { id: 'tx_2', studentId: '1', familyId: 'f1', amount: 30.00, type: 'Charge', description: 'Portfolio Evaluation', date: '2026-04-22', invoiceId: null },
  { id: 'tx_3', studentId: '1', familyId: 'f1', amount: -50.00, type: 'Payment', description: 'EMA Disbursement', date: '2026-04-25', invoiceId: null },
  { id: 'tx_4', studentId: '2', familyId: 'f2', amount: 385.00, type: 'Charge', description: 'Morning POD: Math & Science', date: '2026-04-01', invoiceId: 'INV-100' },
  { id: 'tx_5', studentId: '2', familyId: 'f2', amount: 5.00, type: 'Charge', description: 'Snack - Apple Juice', date: '2026-04-15', invoiceId: null }
];

let globalConfig = {
  nextInvoiceNumber: 4391,
  invoicePrefix: 'LC-'
};

let mockSessionHistory = [
  {
    sessionId: 'session_old_1',
    groupId: '1', // Matches 'Math Foundations - Group A'
    date: '2026-04-17', // Last week
    notes: 'Reviewed fractions and decimals. Most students struggled with converting fractions to percentages. Homework: Exercises 1-15 on page 42.',
    materials: [{ name: 'Fractions_Worksheet.pdf', type: 'application/pdf', url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' }],
    visibility: 'all'
  },
  {
    sessionId: 'session_old_2',
    groupId: '1',
    date: '2026-04-10', // Two weeks ago
    notes: 'Introduced basic geometry concepts (areas of triangles and rectangles). Behavior was excellent today.',
    materials: [],
    visibility: 'teacher'
  },
  {
    sessionId: 'session_old_3',
    groupId: '2', // Matches 'Advanced English'
    date: '2026-04-16',
    notes: 'Practiced past perfect continuous tense. Discussed the reading assignment chapter 3.',
    materials: [{ name: 'Tense_Chart.png', type: 'image/png', url: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800' }],
    visibility: 'students'
  }
];

// --- Chat Data ---
let mockMessages = {
  '1': [
    { id: 1, sender: "Maria Garcia", text: "Hello! I'm ready for the group session today.", time: "10:15 AM", type: "received" },
    { id: 2, sender: "Me", text: "Great! See you at 4:00 PM.", time: "10:20 AM", type: "sent" }
  ],
  '0': [
    { id: 1, sender: "Assistant", text: "Hello! I am your Academy Assistant. I can help you schedule classes, check availability with teachers, or manage your enrollment. How can I help you today?", time: "9:00 AM", type: "received" }
  ]
};

let mockBlockedUsers = [];

// Service Methods
export const database = {
  // --- Families ---
  fetchFamilies: async () => {
    try {
      const response = await api.get('/families?limit=100');
      // Mapear al formato que espera el frontend
      const realFamilies = response.data.families.map(dbFam => {
        return {
          id: dbFam.id,
          name: dbFam.name,
          contacts: dbFam.members.map(m => ({
            name: m.user?.fullName || 'Unknown',
            role: m.role || 'Member',
            isInvoiceRecipient: m.isInvoiceRecipient
          })),
          tags: dbFam.tags || []
        };
      });
      return realFamilies.length > 0 ? realFamilies : mockFamilies;
    } catch (error) {
      console.error("Error fetching real families, falling back to mock:", error);
      return mockFamilies;
    }
  },

  // --- Students ---
  fetchStudents: async () => {
    try {
      const response = await api.get('/students?limit=100');
      
      // Mapear el formato del backend (Prisma) al formato que espera el frontend actual
      const realStudents = response.data.students.map(dbStudent => {
        // Encontrar el padre principal
        const mainParent = dbStudent.familyMembers?.[0]?.family?.members?.find(m => m.role === 'PARENT' || m.role === 'Father' || m.role === 'Mother')?.user;

        return {
          id: dbStudent.id,
          name: dbStudent.fullName,
          age: dbStudent.age || 0,
          parentName: mainParent ? mainParent.fullName : 'No Parent Assigned',
          parentPhone: mainParent ? mainParent.phone : 'N/A',
          parentEmail: mainParent ? mainParent.email : 'N/A',
          allergies: dbStudent.allergies || 'None',
          snackAuthorized: dbStudent.snackAuthorized,
          snackPunches: dbStudent.snackPunches,
          snackHistory: [],
          seashells: dbStudent.seashells,
          seashellHistory: [],
          familyId: dbStudent.familyMembers?.[0]?.familyId || null,
          // Formatear estado (ej. "ACTIVE" -> "Active")
          status: dbStudent.status.charAt(0).toUpperCase() + dbStudent.status.slice(1).toLowerCase(),
          materials: []
        };
      });

      return realStudents.length > 0 ? realStudents : mockStudents; // Fallback al mock si la BD está vacía (para no romper la UI)
    } catch (error) {
      console.error("Error fetching real students, falling back to mock data:", error);
      return mockStudents;
    }
  },

  // --- Teachers ---
  fetchTeachers: async () => {
    try {
      const response = await api.get('/users?role=TEACHER');
      const teachers = response.data.users.map(t => ({
        id: t.id,
        name: t.fullName,
        email: t.email,
        phone: t.phone || 'N/A',
        status: t.status.charAt(0).toUpperCase() + t.status.slice(1).toLowerCase(),
        baseSalary: parseFloat(t.baseSalary || 0),
        perSessionRate: parseFloat(t.perSessionRate || 0),
        classCount: t.familyMembers?.length || 0, // placeholder
      }));
      if (teachers.length > 0) return teachers;
      // Fallback mock
      return [
        { id: 'teacher_1', name: 'Prof. David Brown', email: 'david@academy.com', phone: '(555) 111-2222', status: 'Active', baseSalary: 2000, perSessionRate: 35, classCount: 3 },
        { id: 'teacher_2', name: 'Prof. Sarah Jenkins', email: 'sarah@academy.com', phone: '(555) 333-4444', status: 'Active', baseSalary: 2200, perSessionRate: 40, classCount: 2 },
        { id: 'teacher_3', name: 'Prof. Michael Torres', email: 'michael@academy.com', phone: '(555) 555-6666', status: 'Active', baseSalary: 1800, perSessionRate: 30, classCount: 4 },
      ];
    } catch (error) {
      console.error("Error fetching teachers:", error);
      return [
        { id: 'teacher_1', name: 'Prof. David Brown', email: 'david@academy.com', phone: '(555) 111-2222', status: 'Active', baseSalary: 2000, perSessionRate: 35, classCount: 3 },
        { id: 'teacher_2', name: 'Prof. Sarah Jenkins', email: 'sarah@academy.com', phone: '(555) 333-4444', status: 'Active', baseSalary: 2200, perSessionRate: 40, classCount: 2 },
        { id: 'teacher_3', name: 'Prof. Michael Torres', email: 'michael@academy.com', phone: '(555) 555-6666', status: 'Active', baseSalary: 1800, perSessionRate: 30, classCount: 4 },
      ];
    }
  },

  fetchTeacherPayroll: async (teacherId, month, year) => {
    try {
      const params = [];
      if (month) params.push(`month=${month}`);
      if (year) params.push(`year=${year}`);
      const qs = params.length > 0 ? `?${params.join('&')}` : '';
      const response = await api.get(`/users/${teacherId}/payroll${qs}`);
      return response.data;
    } catch (error) {
      console.error("Error fetching teacher payroll:", error);
      // Fallback mock payroll
      const now = new Date();
      return {
        teacher: { id: teacherId, fullName: 'Teacher', email: '', phone: '' },
        payroll: {
          month: month || (now.getMonth() + 1),
          year: year || now.getFullYear(),
          baseSalary: 2000,
          perSessionRate: 35,
          inPersonSessionCount: 12,
          onlineSessionCount: 8,
          totalSessionCount: 20,
          tutoringEarnings: 280,
          totalEarnings: 2280,
        },
        classes: [
          { id: 'c1', name: 'Math Foundations', subject: 'math', type: 'IN_PERSON', completedSessions: 8, sessions: [] },
          { id: 'c2', name: 'Online Algebra', subject: 'math', type: 'VIRTUAL', completedSessions: 5, sessions: [] },
        ],
      };
    }
  },

  updateStudentHealth: async (studentId, updates) => {
    mockStudents = mockStudents.map(s => s.id === studentId ? { ...s, ...updates } : s);
    return true;
  },

  // --- Snacks & Billing ---
  // Punches/seashells are real earned balances — never fall back to fabricated
  // numbers if the API call fails. Let the error propagate so the UI shows a
  // real error state instead of a purchase that silently vanishes on reload.
  getSnackCabinet: async () => {
    const response = await api.get('/rewards/snacks');
    return response.data.snacks;
  },

  addSnack: async (snackData) => {
    const response = await api.post('/rewards/snacks', snackData);
    return { success: true, snack: response.data.snack };
  },

  deleteSnack: async (snackId) => {
    await api.delete(`/rewards/snacks/${snackId}`);
    return { success: true };
  },

  purchaseSnack: async (studentId, snackId) => {
    const response = await api.post('/rewards/snacks/purchase', { studentId, snackId });
    return response.data; // { success, newBalance, snackName }
  },

  logSnackConsumption: async (studentId) => {
    const student = mockStudents.find(s => s.id === studentId);
    if (!student || !student.snackAuthorized) return false;

    const newCharge = {
      id: `tx_${Date.now()}`,
      studentId: studentId,
      familyId: student.familyId,
      amount: 5.00, // Fixed snack price
      type: 'Charge',
      description: 'Snack Purchase',
      date: new Date().toISOString().split('T')[0],
      invoiceId: null
    };

    mockTransactions.push(newCharge);
    console.log(`[Database] Recorded snack charge for ${student.name}`);
    return true;
  },

  fetchPayments: async (studentId) => {
    return mockTransactions.filter(p => p.studentId === studentId);
  },

  // Billing data is real money — never fall back to fabricated numbers if the
  // API call fails. Let the error propagate so the UI shows a real error state.
  fetchAllTransactions: async () => {
    const response = await api.get('/billing/transactions');
    return response.data.transactions;
  },

  fetchAllInvoices: async () => {
    const response = await api.get('/billing/invoices');
    return response.data.invoices;
  },

  addTransaction: async (tx) => {
    const response = await api.post('/billing/transactions', tx);
    return response.data.transaction;
  },

  generateInvoice: async (familyId, transactionIds) => {
    const response = await api.post('/billing/invoices', { familyId, transactionIds });
    return response.data.invoice;
  },

  generateInvoiceId: async () => {
    const newInvoiceId = `${globalConfig.invoicePrefix}${globalConfig.nextInvoiceNumber}`;
    globalConfig.nextInvoiceNumber++;
    return newInvoiceId;
  },

  // --- EMA Step Up: assign sequential LC-#### invoice numbers per student ---
  // groups: [{ key, studentName, studentId, total, rowIndexes: [...] }]
  // Returns the same groups enriched with { invoiceNumber, familyId, matched }.
  // Real invoices with real money — no mock fallback if the API call fails.
  processEmaBatch: async (groups) => {
    const response = await api.post('/billing/ema/generate', { groups });
    return response.data.groups;
  },

  // --- EMA Step Up: reconcile a lump remittance against generated invoices ---
  // lines: [{ poNumber, studentName, amount }] — remittance references Step Up PO #s.
  // Matches each line to the invoice that covers that PO #, accrues amountPaid,
  // marks invoices PAID once fully covered, and records ledger payments.
  // Real money — no mock fallback if the API call fails.
  reconcileEmaRemittance: async (lines) => {
    const response = await api.post('/billing/ema/reconcile', { lines });
    return response.data;
  },

  // --- Refunds: reverses the Stripe charge if the payment was by card, otherwise ledger-only ---
  refundPayment: async (paymentId, { amount, reason } = {}) => {
    const response = await api.post(`/billing/payments/${paymentId}/refund`, { amount, reason });
    return response.data;
  },

  // --- Prizes System ---
  awardSeashells: async (studentIds, reason, points) => {
    const ids = Array.isArray(studentIds) ? studentIds : [studentIds];
    await api.post('/rewards/seashells/award', { studentIds: ids, reason, points: parseInt(points) });
    return true;
  },

  redeemSeashells: async (studentId, prizeName, cost) => {
    const response = await api.post('/rewards/seashells/redeem', { studentId, reason: `Redeemed: ${prizeName}`, points: parseInt(cost) });
    return response.data; // { success, newBalance }
  },

  // --- Conversations ---
  fetchConversations: async (userId) => {
    return [
      { id: '0', name: "Academy Assistant", lastMsg: "How can I help you?", time: "9:00 AM", unread: 0, roles: ["AI Agent", "Support"], isBot: true, isBlocked: mockBlockedUsers.includes('0') },
      { id: '1', name: "Maria Garcia (Student)", parent: "Elena Garcia", lastMsg: "Tomorrow's lesson is at 4pm?", time: "10:30 AM", unread: 2, roles: ["Student", "Parent"], isBlocked: mockBlockedUsers.includes('1') }
    ];
  },

  blockContact: async (threadId) => {
    if (!mockBlockedUsers.includes(threadId)) {
      mockBlockedUsers.push(threadId);
    }
    return true;
  },

  unblockContact: async (threadId) => {
    mockBlockedUsers = mockBlockedUsers.filter(id => id !== threadId);
    return true;
  },

  fetchMessages: async (threadId) => {
    return mockMessages[threadId] || [];
  },

  sendMessage: async (threadId, text, sender = "Me") => {
    if (!mockMessages[threadId]) {
      mockMessages[threadId] = [];
    }

    const newMessage = {
      id: Date.now(),
      sender: sender,
      text: text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: sender === "Me" ? "sent" : "received"
    };

    mockMessages[threadId].push(newMessage);

    // AI Simulation for Assistant thread
    if (threadId === '0' && sender === "Me") {
      setTimeout(() => {
        let responseText = "I'm processing your request. Give me a moment...";
        const lowerText = text.toLowerCase();
        
        if (lowerText.includes("math") || lowerText.includes("class") || lowerText.includes("mate")) {
          responseText = "I see you're looking for a math class. I found Prof. David Brown is available tomorrow at 4:30 PM. Would you like me to book it for you?";
        } else if (lowerText.includes("yes") || lowerText.includes("si")) {
          responseText = "Perfect! The class has been scheduled. I've updated your calendar. Anything else?";
        } else if (lowerText.includes("bill") || lowerText.includes("invoice") || lowerText.includes("pay")) {
          responseText = "Your current balance is $125.00 due on April 25. You can view the details in the Billing section. Need help paying it?";
        }

        const aiMessage = {
          id: Date.now() + 1,
          sender: "Assistant",
          text: responseText,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: "received"
        };
        mockMessages['0'].push(aiMessage);
      }, 1500); // Simulate network/AI delay
    }

    return newMessage;
  },

  // --- Student Specific Dashboard Data ---
  fetchStudentData: async (studentId) => {
    try {
      const response = await api.get('/dashboard');
      const d = response.data;
      
      // The backend already returns data in the exact shape we need
      return {
        upcomingSessions: d.upcomingSessions || [],
        billing: d.billing || { nextPayment: '$0.00', dueDate: 'N/A', pendingCharges: [] },
        notifications: d.notifications || [],
        recentSessions: d.recentSessions || [],
        stats: d.stats || {}
      };
    } catch (error) {
      console.error("Error fetching dashboard from API, using fallback:", error);
      // Fallback mock data
      return {
        upcomingSessions: [
          { id: 's1', subject: 'English Conversation', teacher: 'Prof. Sarah Jenkins', time: 'Today, 4:00 PM', status: 'upcoming', type: 'Virtual', meetingUrl: 'https://zoom.us/j/123456789' },
          { id: 's2', subject: 'Mathematics Advanced', teacher: 'Prof. David Brown', time: 'Tomorrow, 10:00 AM', status: 'upcoming', type: 'In-person' },
        ],
        billing: {
          nextPayment: '$120.00',
          dueDate: 'April 25, 2026',
          pendingCharges: [{ item: 'Snack Log - April 18', amount: '$5.00' }]
        },
        notifications: [
          { id: 1, text: "The Academy will be closed on May 1st.", date: "2 hours ago", type: "info" },
          { id: 2, text: "New resources published for Math Foundations.", date: "5 hours ago", type: "update" },
        ],
        recentSessions: []
      };
    }
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
  },

  // --- Chat ---
  fetchConversations: async () => {
    return Promise.resolve([
      { id: '0', name: 'Academy Assistant (AI)', isBot: true, isBlocked: false },
      { id: '1', name: 'Maria Garcia', roles: ['Parent', 'Garcia Family'], isBot: false, isBlocked: mockBlockedUsers.includes('1') },
      { id: '2', name: 'Michael Doe', roles: ['Parent', 'Doe Family'], isBot: false, isBlocked: mockBlockedUsers.includes('2') }
    ]);
  },
  
  fetchMessages: async (chatId) => {
    return Promise.resolve(mockMessages[chatId] || []);
  },
  
  sendMessage: async (chatId, text) => {
    if (!mockMessages[chatId]) {
      mockMessages[chatId] = [];
    }
    const newMsg = {
      id: Date.now(),
      sender: "Me",
      text: text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: "sent"
    };
    mockMessages[chatId].push(newMsg);
    
    // Simulate AI bot response
    if (chatId === '0') {
      setTimeout(() => {
        mockMessages[chatId].push({
          id: Date.now() + 1,
          sender: "Assistant",
          text: "I understand you need help with that. Let me look up the information for you.",
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: "received"
        });
      }, 1500);
    }
    
    return Promise.resolve(newMsg);
  },
  
  blockContact: async (chatId) => {
    if (!mockBlockedUsers.includes(chatId)) {
      mockBlockedUsers.push(chatId);
    }
    return Promise.resolve(true);
  },
  
  unblockContact: async (chatId) => {
    mockBlockedUsers = mockBlockedUsers.filter(id => id !== chatId);
    return Promise.resolve(true);
  },

  // --- Class Sessions ---
  fetchSessionHistory: async (groupId) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(groupId)) {
      const history = mockSessionHistory.filter(h => h.groupId === String(groupId));
      return history.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    const response = await api.get(`/sessions?classId=${groupId}`);
    const realSessions = response.data.sessions.map(s => ({
      sessionId: s.id,
      groupId: s.classId,
      date: s.date,
      notes: s.notes?.[0]?.notes || '',
      recordingUrl: s.notes?.[0]?.recordingUrl || '',
      // Normalize DB field names (fileUrl/fileType) to match locally-uploaded
      // files (url/type) so the preview modal works for either source.
      materials: (s.materials || []).map(m => ({ name: m.name, url: m.fileUrl, type: m.fileType })),
      visibility: s.notes?.[0]?.visibility || 'all',
    }));
    return realSessions.sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  saveClassNotes: async (sessionId, notes, files, visibility = 'all', recordingUrl = '') => {
    try {
      await api.post(`/sessions/${sessionId}/notes`, {
        notes,
        visibility,
        recordingUrl
      });
      console.log(`[Database] Saved notes for session ${sessionId} [Visibility: ${visibility}] via API`);
      return true;
    } catch (error) {
      console.error("Error saving real session notes, falling back to mock:", error);
      const newEntry = {
        sessionId: `session_${Date.now()}`,
        groupId: sessionId,
        date: new Date().toISOString(),
        notes: notes,
        materials: files || [],
        visibility: visibility,
        recordingUrl: recordingUrl
      };
      mockSessionHistory.unshift(newEntry);
      return true;
    }
  },

  // Marks the session COMPLETED server-side. Payroll only counts sessions in this
  // status (plus real attendance), so scheduling a class must never pay a teacher —
  // only actually finishing it does.
  completeSession: async (sessionId) => {
    try {
      await api.put(`/sessions/${sessionId}`, { status: 'COMPLETED' });
      console.log(`[Database] Marked session ${sessionId} as COMPLETED`);
      return true;
    } catch (error) {
      console.error("Error completing session:", error);
      return false;
    }
  },

  saveAttendance: async (sessionId, attendanceData) => {
    try {
      // Convert frontend attendance map to backend array
      // Frontend might pass: { "studentId1": "PRESENT", "studentId2": "LATE" }
      const records = Object.keys(attendanceData).map(studentId => ({
        studentId,
        status: attendanceData[studentId]
      }));
      
      await api.put(`/sessions/${sessionId}/attendance`, {
        attendanceRecords: records
      });
      
      console.log(`[Database] Saved real attendance for session ${sessionId}`);
      return true;
    } catch (error) {
      console.error("Error saving real attendance:", error);
      return false;
    }
  },

  // Cancellation policy: >=48h before class is free (auto-resolved server-side);
  // <48h suggests a 50% charge but never charges automatically — it opens an
  // admin review item instead. Real money — no mock fallback if this fails.
  cancelStudentSession: async (sessionId, studentId, reason) => {
    const response = await api.post(`/sessions/${sessionId}/cancel-student`, { studentId, reason });
    return response.data; // { cancellation, autoResolved }
  },

  fetchPendingCancellations: async () => {
    const response = await api.get('/sessions/cancellations', { params: { status: 'PENDING_REVIEW' } });
    return response.data.cancellations;
  },

  resolveCancellation: async (cancellationId, finalChargePercent, chargeAmount) => {
    const response = await api.patch(`/sessions/cancellations/${cancellationId}/resolve`, {
      finalChargePercent,
      chargeAmount: chargeAmount || null,
    });
    return response.data.cancellation;
  },

  fetchDailySessions: async () => {
    try {
      // Get today's date in YYYY-MM-DD
      const today = new Date().toISOString().split('T')[0];
      const response = await api.get(`/sessions?startDate=${today}&endDate=${today}`);
      const sessions = response.data.sessions;
      
      if (sessions.length > 0) {
        return sessions.map(s => ({
          id: s.id,
          title: s.class?.name || 'Class Session',
          time: new Date(s.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + ' - ' + new Date(s.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
          studentsCount: 0, // Should come from enrollments ideally
          status: s.status === 'COMPLETED' ? 'completed' : 'pending',
          link: s.class?.meetingUrl || '#'
        }));
      }
      return null;
    } catch (error) {
      console.error("Error fetching daily sessions:", error);
      return null;
    }
  }
};
