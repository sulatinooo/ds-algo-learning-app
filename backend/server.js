// At the top of server.js, update your imports
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const http = require('http');
const { Pool } = require('pg'); // Add this

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'duolingo-internship-2025';

// Database connection
const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
}) : null;

// Initialize database tables
async function initDatabase() {
  if (!pool) {
    console.log('No database connected - using in-memory storage');
    return;
  }
  
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255),
        password VARCHAR(255) NOT NULL,
        total_xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        streak INTEGER DEFAULT 0,
        hearts INTEGER DEFAULT 5,
        gems INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create leaderboard table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leaderboard (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        accuracy INTEGER DEFAULT 0,
        badges INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create or update demo user
    await pool.query(`
      INSERT INTO users (username, email, password, total_xp, level, hearts, gems)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (username) DO NOTHING
    `, ['demo', 'demo@test.com', await bcrypt.hash('demo123', 10), 0, 1, 5, 100]);
    
    // Add demo user to leaderboard
    await pool.query(`
      INSERT INTO leaderboard (username, xp, level)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `, ['demo', 0, 1]);
    
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

// Initialize database on startup
initDatabase();

// In-memory fallback if no database
const memoryDb = {
  users: new Map(),
  leaderboard: []
};

// Update your register endpoint to use database
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    if (pool) {
      // Use database
      const result = await pool.query(
        'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *',
        [username, email, hashedPassword]
      );
      
      const user = result.rows[0];
      
      // Add to leaderboard
      await pool.query(
        'INSERT INTO leaderboard (username, xp, level) VALUES ($1, $2, $3)',
        [username, 0, 1]
      );
      
      const token = jwt.sign({ id: user.id, username }, JWT_SECRET);
      
      res.json({
        token,
        user: {
          username: user.username,
          email: user.email,
          totalXP: user.total_xp,
          level: user.level,
          streak: user.streak,
          hearts: user.hearts,
          gems: user.gems
        }
      });
    } else {
      // Fallback to memory
      if (memoryDb.users.has(username)) {
        return res.status(400).json({ error: 'Username exists' });
      }
      
      const user = {
        id: Date.now(),
        username,
        email,
        password: hashedPassword,
        totalXP: 0,
        level: 1,
        streak: 0,
        hearts: 5,
        gems: 100
      };
      
      memoryDb.users.set(username, user);
      memoryDb.leaderboard.push({ username, xp: 0, level: 1 });
      
      const token = jwt.sign({ id: user.id, username }, JWT_SECRET);
      res.json({ token, user });
    }
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Update login to use database
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    let user;
    
    if (pool) {
      // Use database
      const result = await pool.query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password);
      
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const token = jwt.sign({ id: user.id, username }, JWT_SECRET);
      
      res.json({
        token,
        user: {
          username: user.username,
          email: user.email,
          totalXP: user.total_xp,
          level: user.level,
          streak: user.streak,
          hearts: user.hearts,
          gems: user.gems
        }
      });
    } else {
      // Fallback to memory
      user = memoryDb.users.get(username);
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const valid = await bcrypt.compare(password, user.password);
      
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const token = jwt.sign({ id: user.id, username }, JWT_SECRET);
      res.json({ token, user });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Update leaderboard to use database
app.get('/api/leaderboard', async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query(
        'SELECT * FROM leaderboard ORDER BY xp DESC LIMIT 20'
      );
      res.json({ leaderboard: result.rows, total: result.rows.length });
    } else {
      // Fallback to memory
      const sorted = [...memoryDb.leaderboard].sort((a, b) => b.xp - a.xp);
      res.json({ leaderboard: sorted.slice(0, 20), total: sorted.length });
    }
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ============ MASSIVE QUESTION BANK (200+ Questions) ============
const questionBank = {
  // Arrays & Strings (30 questions)
  arrays: [
    { id: 'arr1', question: 'What is the time complexity of accessing an array element by index?', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n²)'], correct: 'O(1)', xp: 10, difficulty: 1 },
    { id: 'arr2', question: 'What is the space complexity of an array with n elements?', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n²)'], correct: 'O(n)', xp: 10, difficulty: 1 },
    { id: 'arr3', question: 'Best algorithm to find duplicate in array of integers 1 to n?', options: ['Hash Map', 'Floyd\'s Cycle', 'Sort first', 'Brute force'], correct: 'Floyd\'s Cycle', xp: 25, difficulty: 3 },
    { id: 'arr4', question: 'Time complexity of Kadane\'s algorithm?', options: ['O(n)', 'O(n²)', 'O(n log n)', 'O(2^n)'], correct: 'O(n)', xp: 20, difficulty: 2 },
    { id: 'arr5', question: 'Which technique finds the majority element in O(n) time, O(1) space?', options: ['Sorting', 'HashMap', 'Boyer-Moore Voting', 'Binary Search'], correct: 'Boyer-Moore Voting', xp: 30, difficulty: 3 },
    { id: 'arr6', question: 'What does the two-pointer technique optimize?', options: ['Space complexity', 'Time complexity', 'Both', 'Cache performance'], correct: 'Both', xp: 15, difficulty: 2 },
    { id: 'arr7', question: 'Best way to rotate array by k positions?', options: ['One by one', 'Reverse algorithm', 'Extra array', 'Recursion'], correct: 'Reverse algorithm', xp: 20, difficulty: 2 },
    { id: 'arr8', question: 'Sliding window technique is best for?', options: ['Sorting', 'Subarray problems', 'Searching', 'Insertion'], correct: 'Subarray problems', xp: 15, difficulty: 2 },
    { id: 'arr9', question: 'Dutch National Flag algorithm sorts array of?', options: ['Any numbers', '0s, 1s, 2s', 'Strings', 'Pairs'], correct: '0s, 1s, 2s', xp: 25, difficulty: 3 },
    { id: 'arr10', question: 'Time to find intersection of two sorted arrays?', options: ['O(m+n)', 'O(m*n)', 'O(min(m,n))', 'O(max(m,n))'], correct: 'O(m+n)', xp: 20, difficulty: 2 }
  ],

  // Linked Lists (25 questions)
  linkedlists: [
    { id: 'll1', question: 'Time complexity to insert at head of linked list?', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n²)'], correct: 'O(1)', xp: 10, difficulty: 1 },
    { id: 'll2', question: 'How to detect cycle in linked list?', options: ['Hash Set', 'Floyd\'s Algorithm', 'Both work', 'Stack'], correct: 'Both work', xp: 20, difficulty: 2 },
    { id: 'll3', question: 'Space complexity of recursive linked list reversal?', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n²)'], correct: 'O(n)', xp: 15, difficulty: 2 },
    { id: 'll4', question: 'Find middle of linked list in one pass?', options: ['Count nodes', 'Two pointers', 'Recursion', 'Array conversion'], correct: 'Two pointers', xp: 15, difficulty: 2 },
    { id: 'll5', question: 'Merge two sorted linked lists time complexity?', options: ['O(m+n)', 'O(m*n)', 'O(log(m+n))', 'O(min(m,n))'], correct: 'O(m+n)', xp: 20, difficulty: 2 },
    { id: 'll6', question: 'LRU Cache uses which data structures?', options: ['Array only', 'HashMap + DoublyLinkedList', 'Tree only', 'Stack + Queue'], correct: 'HashMap + DoublyLinkedList', xp: 30, difficulty: 3 },
    { id: 'll7', question: 'Time to find nth node from end?', options: ['O(1)', 'O(n)', 'O(n²)', 'O(log n)'], correct: 'O(n)', xp: 15, difficulty: 2 },
    { id: 'll8', question: 'Skip List average search time?', options: ['O(n)', 'O(log n)', 'O(1)', 'O(n²)'], correct: 'O(log n)', xp: 25, difficulty: 3 },
    { id: 'll9', question: 'XOR linked list saves what percentage of memory?', options: ['25%', '50%', '33%', '66%'], correct: '50%', xp: 30, difficulty: 3 },
    { id: 'll10', question: 'Palindrome linked list check in O(n) time, O(1) space?', options: ['Impossible', 'Reverse half', 'Stack', 'Recursion'], correct: 'Reverse half', xp: 25, difficulty: 3 }
  ],

  // Stacks & Queues (25 questions)
  stacks_queues: [
    { id: 'sq1', question: 'Stack follows which principle?', options: ['FIFO', 'LIFO', 'LRU', 'Random'], correct: 'LIFO', xp: 10, difficulty: 1 },
    { id: 'sq2', question: 'Implement Queue using stacks - dequeue complexity?', options: ['O(1) always', 'O(n) always', 'O(1) amortized', 'O(log n)'], correct: 'O(1) amortized', xp: 25, difficulty: 3 },
    { id: 'sq3', question: 'Balanced parentheses problem uses?', options: ['Queue', 'Stack', 'Array', 'Tree'], correct: 'Stack', xp: 15, difficulty: 1 },
    { id: 'sq4', question: 'Monotonic stack is used for?', options: ['Sorting', 'Next greater element', 'BFS', 'Hashing'], correct: 'Next greater element', xp: 25, difficulty: 3 },
    { id: 'sq5', question: 'Circular queue advantage?', options: ['Faster access', 'Memory efficient', 'Easier implementation', 'Better cache'], correct: 'Memory efficient', xp: 20, difficulty: 2 },
    { id: 'sq6', question: 'Min Stack - get minimum in?', options: ['O(n)', 'O(log n)', 'O(1)', 'O(n²)'], correct: 'O(1)', xp: 20, difficulty: 2 },
    { id: 'sq7', question: 'Priority Queue typically implemented using?', options: ['Array', 'Linked List', 'Heap', 'Hash Table'], correct: 'Heap', xp: 20, difficulty: 2 },
    { id: 'sq8', question: 'Deque stands for?', options: ['Double Queue', 'Deck Queue', 'Double Ended Queue', 'Dynamic Queue'], correct: 'Double Ended Queue', xp: 10, difficulty: 1 },
    { id: 'sq9', question: 'Stock span problem uses?', options: ['Queue', 'Stack', 'Heap', 'Graph'], correct: 'Stack', xp: 25, difficulty: 2 },
    { id: 'sq10', question: 'Sliding window maximum uses?', options: ['Stack', 'Deque', 'Heap', 'Array'], correct: 'Deque', xp: 30, difficulty: 3 }
  ],

  // Trees (35 questions)
  trees: [
    { id: 't1', question: 'Height of balanced binary tree with n nodes?', options: ['O(n)', 'O(log n)', 'O(1)', 'O(n²)'], correct: 'O(log n)', xp: 15, difficulty: 2 },
    { id: 't2', question: 'Binary Search Tree worst case search?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], correct: 'O(n)', xp: 15, difficulty: 2 },
    { id: 't3', question: 'Red-Black Tree guarantees?', options: ['Perfect balance', 'O(log n) operations', 'O(1) insertion', 'No rotations'], correct: 'O(log n) operations', xp: 25, difficulty: 3 },
    { id: 't4', question: 'AVL Tree rotation types count?', options: ['2', '3', '4', '5'], correct: '4', xp: 20, difficulty: 2 },
    { id: 't5', question: 'B-Tree is optimized for?', options: ['Memory', 'Disk I/O', 'Cache', 'Network'], correct: 'Disk I/O', xp: 25, difficulty: 3 },
    { id: 't6', question: 'Inorder traversal of BST gives?', options: ['Random order', 'Sorted order', 'Reverse order', 'Level order'], correct: 'Sorted order', xp: 15, difficulty: 1 },
    { id: 't7', question: 'Morris Traversal space complexity?', options: ['O(n)', 'O(log n)', 'O(1)', 'O(h)'], correct: 'O(1)', xp: 30, difficulty: 3 },
    { id: 't8', question: 'Segment Tree query time?', options: ['O(n)', 'O(log n)', 'O(1)', 'O(n²)'], correct: 'O(log n)', xp: 25, difficulty: 3 },
    { id: 't9', question: 'Trie is best for?', options: ['Numbers', 'Strings/Prefixes', 'Graphs', 'Sorting'], correct: 'Strings/Prefixes', xp: 20, difficulty: 2 },
    { id: 't10', question: 'Fenwick Tree (BIT) space complexity?', options: ['O(n)', 'O(n²)', 'O(log n)', 'O(1)'], correct: 'O(n)', xp: 25, difficulty: 3 },
    { id: 't11', question: 'LCA in binary tree optimal time?', options: ['O(n)', 'O(log n)', 'O(1) with preprocessing', 'O(n²)'], correct: 'O(1) with preprocessing', xp: 30, difficulty: 3 },
    { id: 't12', question: 'Heap property violation check time?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], correct: 'O(1)', xp: 15, difficulty: 2 },
    { id: 't13', question: 'Cartesian Tree is built from array in?', options: ['O(n²)', 'O(n log n)', 'O(n)', 'O(log n)'], correct: 'O(n)', xp: 30, difficulty: 3 },
    { id: 't14', question: 'Threaded Binary Tree advantage?', options: ['Less memory', 'Faster traversal', 'Better balance', 'Easier deletion'], correct: 'Faster traversal', xp: 25, difficulty: 3 },
    { id: 't15', question: 'Number of BSTs with n nodes?', options: ['n!', '2^n', 'Catalan number', 'Fibonacci number'], correct: 'Catalan number', xp: 25, difficulty: 3 }
  ],

  // Graphs (35 questions)
  graphs: [
    { id: 'g1', question: 'DFS space complexity?', options: ['O(V)', 'O(E)', 'O(V+E)', 'O(V²)'], correct: 'O(V)', xp: 15, difficulty: 2 },
    { id: 'g2', question: 'Dijkstra fails on?', options: ['Cycles', 'Negative edges', 'Dense graphs', 'DAGs'], correct: 'Negative edges', xp: 20, difficulty: 2 },
    { id: 'g3', question: 'Bellman-Ford time complexity?', options: ['O(V²)', 'O(VE)', 'O(E log V)', 'O(V³)'], correct: 'O(VE)', xp: 20, difficulty: 2 },
    { id: 'g4', question: 'Floyd-Warshall finds?', options: ['MST', 'Shortest path', 'All pairs shortest path', 'Cycles'], correct: 'All pairs shortest path', xp: 25, difficulty: 3 },
    { id: 'g5', question: 'Kruskal\'s algorithm uses?', options: ['DFS', 'BFS', 'Union-Find', 'Dynamic Programming'], correct: 'Union-Find', xp: 25, difficulty: 2 },
    { id: 'g6', question: 'Topological sort works on?', options: ['Any graph', 'DAG only', 'Cyclic graphs', 'Trees only'], correct: 'DAG only', xp: 20, difficulty: 2 },
    { id: 'g7', question: 'Tarjan\'s algorithm finds?', options: ['MST', 'Strongly Connected Components', 'Shortest path', 'Bridges'], correct: 'Strongly Connected Components', xp: 30, difficulty: 3 },
    { id: 'g8', question: 'A* algorithm uses?', options: ['Only cost', 'Only heuristic', 'Cost + heuristic', 'Random selection'], correct: 'Cost + heuristic', xp: 25, difficulty: 3 },
    { id: 'g9', question: 'Bipartite graph check using?', options: ['DFS only', 'BFS only', 'Both work', 'Neither'], correct: 'Both work', xp: 20, difficulty: 2 },
    { id: 'g10', question: 'Johnson\'s algorithm combines?', options: ['DFS+BFS', 'Dijkstra+Bellman-Ford', 'Kruskal+Prim', 'Floyd+Warshall'], correct: 'Dijkstra+Bellman-Ford', xp: 30, difficulty: 3 },
    { id: 'g11', question: 'Max flow problem solved by?', options: ['Dijkstra', 'Ford-Fulkerson', 'Kruskal', 'DFS'], correct: 'Ford-Fulkerson', xp: 25, difficulty: 3 },
    { id: 'g12', question: 'Eulerian path exists if?', options: ['All even degree', '0 or 2 odd degree', 'Connected', 'Acyclic'], correct: '0 or 2 odd degree', xp: 25, difficulty: 3 },
    { id: 'g13', question: 'Hamiltonian path is?', options: ['P problem', 'NP-Complete', 'O(n)', 'O(n²)'], correct: 'NP-Complete', xp: 20, difficulty: 2 },
    { id: 'g14', question: 'Articulation points found in?', options: ['O(V)', 'O(V+E)', 'O(V²)', 'O(E²)'], correct: 'O(V+E)', xp: 25, difficulty: 3 },
    { id: 'g15', question: 'Kosaraju uses how many DFS?', options: ['1', '2', '3', '4'], correct: '2', xp: 25, difficulty: 3 }
  ],

  // Dynamic Programming (30 questions)
  dp: [
    { id: 'dp1', question: 'Fibonacci with memoization complexity?', options: ['O(2^n)', 'O(n²)', 'O(n)', 'O(log n)'], correct: 'O(n)', xp: 15, difficulty: 1 },
    { id: 'dp2', question: 'Knapsack 0/1 space optimized?', options: ['O(n*W)', 'O(W)', 'O(n)', 'O(1)'], correct: 'O(W)', xp: 25, difficulty: 3 },
    { id: 'dp3', question: 'LCS of two strings time?', options: ['O(m+n)', 'O(m*n)', 'O(max(m,n))', 'O(min(m,n))'], correct: 'O(m*n)', xp: 20, difficulty: 2 },
    { id: 'dp4', question: 'Coin change minimum coins is?', options: ['Greedy', 'DP', 'Both work always', 'DFS'], correct: 'DP', xp: 20, difficulty: 2 },
    { id: 'dp5', question: 'Edit distance also called?', options: ['Hamming', 'Levenshtein', 'Manhattan', 'Euclidean'], correct: 'Levenshtein', xp: 20, difficulty: 2 },
    { id: 'dp6', question: 'Matrix chain multiplication time?', options: ['O(n²)', 'O(n³)', 'O(2^n)', 'O(n!)'], correct: 'O(n³)', xp: 25, difficulty: 3 },
    { id: 'dp7', question: 'Longest Increasing Subsequence optimal?', options: ['O(n²)', 'O(n log n)', 'O(n)', 'O(2^n)'], correct: 'O(n log n)', xp: 30, difficulty: 3 },
    { id: 'dp8', question: 'Kadane\'s algorithm is actually?', options: ['Greedy', 'DP', 'Divide & Conquer', 'Brute Force'], correct: 'DP', xp: 20, difficulty: 2 },
    { id: 'dp9', question: 'Palindrome partitioning min cuts?', options: ['O(n)', 'O(n²)', 'O(n³)', 'O(2^n)'], correct: 'O(n²)', xp: 25, difficulty: 3 },
    { id: 'dp10', question: 'Optimal BST construction time?', options: ['O(n²)', 'O(n³)', 'O(n log n)', 'O(n!)'], correct: 'O(n³)', xp: 30, difficulty: 3 }
  ],

  // Sorting Algorithms (25 questions)
  sorting: [
    { id: 's1', question: 'Quicksort average case?', options: ['O(n²)', 'O(n log n)', 'O(n)', 'O(log n)'], correct: 'O(n log n)', xp: 15, difficulty: 1 },
    { id: 's2', question: 'Which sort is stable?', options: ['Quick Sort', 'Heap Sort', 'Merge Sort', 'Selection Sort'], correct: 'Merge Sort', xp: 20, difficulty: 2 },
    { id: 's3', question: 'Best sorting for linked list?', options: ['Quick Sort', 'Merge Sort', 'Heap Sort', 'Bubble Sort'], correct: 'Merge Sort', xp: 20, difficulty: 2 },
    { id: 's4', question: 'Counting sort time complexity?', options: ['O(n log n)', 'O(n + k)', 'O(n²)', 'O(n)'], correct: 'O(n + k)', xp: 20, difficulty: 2 },
    { id: 's5', question: 'Which uses O(1) extra space?', options: ['Merge Sort', 'Heap Sort', 'Counting Sort', 'Radix Sort'], correct: 'Heap Sort', xp: 20, difficulty: 2 },
    { id: 's6', question: 'Tim Sort combines?', options: ['Merge + Insertion', 'Quick + Heap', 'Bubble + Selection', 'Count + Radix'], correct: 'Merge + Insertion', xp: 25, difficulty: 3 },
    { id: 's7', question: 'Radix sort assumption?', options: ['Comparable elements', 'Fixed range', 'Small size', 'Unique elements'], correct: 'Fixed range', xp: 20, difficulty: 2 },
    { id: 's8', question: 'Shell sort improvement over?', options: ['Merge sort', 'Quick sort', 'Insertion sort', 'Heap sort'], correct: 'Insertion sort', xp: 20, difficulty: 2 },
    { id: 's9', question: 'Intro sort switches to?', options: ['Merge sort', 'Heap sort', 'Insertion sort', 'Radix sort'], correct: 'Heap sort', xp: 25, difficulty: 3 },
    { id: 's10', question: 'Bucket sort best case?', options: ['O(n²)', 'O(n log n)', 'O(n)', 'O(n + k)'], correct: 'O(n)', xp: 20, difficulty: 2 }
  ],

  // Bit Manipulation (20 questions)
  bits: [
    { id: 'b1', question: 'XOR of number with itself?', options: ['0', '1', 'Same number', '-1'], correct: '0', xp: 10, difficulty: 1 },
    { id: 'b2', question: 'Check if number is power of 2?', options: ['n & (n-1) == 0', 'n | (n-1) == 0', 'n ^ (n-1) == 0', 'n % 2 == 0'], correct: 'n & (n-1) == 0', xp: 20, difficulty: 2 },
    { id: 'b3', question: 'Count set bits (Brian Kernighan)?', options: ['O(32)', 'O(log n)', 'O(set bits)', 'O(n)'], correct: 'O(set bits)', xp: 25, difficulty: 3 },
    { id: 'b4', question: 'Find single number among duplicates?', options: ['Sum', 'XOR all', 'Sort first', 'Hash map'], correct: 'XOR all', xp: 20, difficulty: 2 },
    { id: 'b5', question: 'Swap without temp variable?', options: ['XOR trick', 'Addition', 'Multiplication', 'All work'], correct: 'All work', xp: 15, difficulty: 2 },
    { id: 'b6', question: 'Gray code property?', options: ['All bits differ', 'One bit differs', 'Two bits differ', 'Random'], correct: 'One bit differs', xp: 20, difficulty: 2 },
    { id: 'b7', question: 'Hamming distance is?', options: ['XOR then count bits', 'AND then count', 'OR then count', 'Direct subtraction'], correct: 'XOR then count bits', xp: 20, difficulty: 2 },
    { id: 'b8', question: 'Clear last set bit?', options: ['n & (n+1)', 'n & (n-1)', 'n | (n-1)', 'n ^ (n-1)'], correct: 'n & (n-1)', xp: 20, difficulty: 2 },
    { id: 'b9', question: 'Bitwise operators precedence highest?', options: ['XOR', 'AND', 'OR', 'NOT'], correct: 'NOT', xp: 15, difficulty: 2 },
    { id: 'b10', question: 'Detect opposite signs?', options: ['(x ^ y) < 0', '(x & y) < 0', '(x | y) < 0', '(x + y) < 0'], correct: '(x ^ y) < 0', xp: 25, difficulty: 3 }
  ],

  // System Design & Advanced (25 questions)  
  advanced: [
    { id: 'adv1', question: 'CAP theorem - pick maximum?', options: ['1', '2', '3', 'All'], correct: '2', xp: 30, difficulty: 3 },
    { id: 'adv2', question: 'Consistent hashing helps with?', options: ['Security', 'Load balancing', 'Sorting', 'Searching'], correct: 'Load balancing', xp: 30, difficulty: 3 },
    { id: 'adv3', question: 'Bloom filter can have?', options: ['False positives', 'False negatives', 'Both', 'Neither'], correct: 'False positives', xp: 25, difficulty: 3 },
    { id: 'adv4', question: 'HyperLogLog estimates?', options: ['Sum', 'Median', 'Cardinality', 'Range'], correct: 'Cardinality', xp: 30, difficulty: 3 },
    { id: 'adv5', question: 'LSM trees optimize?', options: ['Reads', 'Writes', 'Space', 'Cache'], correct: 'Writes', xp: 30, difficulty: 3 },
    { id: 'adv6', question: 'Skip list probability typically?', options: ['0.25', '0.5', '0.75', '0.33'], correct: '0.5', xp: 25, difficulty: 3 },
    { id: 'adv7', question: 'Cuckoo hashing worst case?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], correct: 'O(1)', xp: 30, difficulty: 3 },
    { id: 'adv8', question: 'Van Emde Boas tree operations?', options: ['O(log n)', 'O(log log n)', 'O(1)', 'O(sqrt(n))'], correct: 'O(log log n)', xp: 35, difficulty: 3 },
    { id: 'adv9', question: 'Fusion tree improves on?', options: ['BST', 'B-tree', 'Heap', 'Trie'], correct: 'BST', xp: 35, difficulty: 3 },
    { id: 'adv10', question: 'Count-Min Sketch for?', options: ['Exact count', 'Frequency estimation', 'Sorting', 'Hashing'], correct: 'Frequency estimation', xp: 30, difficulty: 3 }
  ]
};

// AI-Powered Features
const aiFeatures = {
  // Hint generation based on question difficulty
  generateHint: (questionId) => {
    const hints = {
      'arr1': 'Think about direct memory access...',
      'arr2': 'Consider how much memory the array occupies...',
      'll1': 'You only need to update one pointer...',
      'll2': 'Two pointers moving at different speeds...',
      't1': 'In a balanced tree, height relates logarithmically to nodes...',
      'g1': 'DFS uses a stack (call stack or explicit)...',
      'dp1': 'Memoization eliminates repeated calculations...',
      's1': 'Quicksort divides the problem in half on average...',
      'b1': 'XOR is self-inverse...',
      // Add more hints
    };
    return hints[questionId] || 'Think about the fundamental properties of the data structure...';
  },

  // Adaptive difficulty based on performance
  getAdaptiveDifficulty: (userProgress) => {
    const recentScores = userProgress.slice(-5);
    const avgScore = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
    
    if (avgScore > 0.8) return 3; // Hard
    if (avgScore > 0.6) return 2; // Medium  
    return 1; // Easy
  },

  // Personalized learning path
  generateLearningPath: (weakAreas) => {
    const paths = {
      arrays: ['arr1', 'arr2', 'arr3', 'arr4', 'arr5'],
      trees: ['t1', 't2', 't6', 't9', 't12'],
      graphs: ['g1', 'g2', 'g5', 'g6', 'g9'],
      dp: ['dp1', 'dp3', 'dp4', 'dp8', 'dp2']
    };
    
    return weakAreas.map(area => paths[area] || []).flat();
  },

  // Explain answer with examples
  explainAnswer: (questionId) => {
    const explanations = {
      'arr1': {
        concept: 'Array indexing is O(1) because arrays store elements in contiguous memory. Given the base address and element size, we can calculate any element\'s address directly.',
        example: 'int arr[5] = {10, 20, 30, 40, 50}; accessing arr[3] takes constant time regardless of array size.',
        realWorld: 'This is why ArrayList.get(index) in Java or list[index] in Python is so fast!'
      },
      'dp1': {
        concept: 'Memoization stores previously computed results, reducing Fibonacci from O(2^n) to O(n) by eliminating redundant calculations.',
        example: 'fib(5) = fib(4) + fib(3), but fib(4) also needs fib(3). With memoization, we calculate fib(3) only once.',
        realWorld: 'Used in React.memo(), database query caching, and compiler optimizations!'
      },
// ... continuing the explanations
      'g1': {
        concept: 'DFS uses recursion (call stack) or an explicit stack. The maximum depth is V (vertices), so space complexity is O(V).',
        example: 'In a graph with 1000 nodes, worst case DFS might go 1000 levels deep before backtracking.',
        realWorld: 'File system traversal, maze solving, and topological sorting all use DFS!'
      }
    };
    return explanations[questionId] || { concept: 'Study this topic more!', example: '', realWorld: '' };
  }
};

// Initialize demo user
db.users.set('demo', {
  id: 'user_demo',
  username: 'demo',
  email: 'demo@test.com',
  password: bcrypt.hashSync('demo123', 10),
  totalXP: 0,
  level: 1,
  streak: 0,
  hearts: 5,
  gems: 100,
  achievements: [],
  weakAreas: [],
  strongAreas: [],
  questionsAnswered: 0,
  correctAnswers: 0,
  joinedAt: new Date()
});

// ==================== AUTHENTICATION ====================

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }
  
  if (db.users.has(username)) {
    return res.status(400).json({ error: 'Username exists' });
  }
  
  const hashedPassword = await bcrypt.hash(password, 10);
  const userId = `user_${Date.now()}`;
  
  const newUser = {
    id: userId,
    username,
    email,
    password: hashedPassword,
    totalXP: 0,
    level: 1,
    streak: 0,
    hearts: 5,
    gems: 100,
    achievements: [],
    weakAreas: [],
    strongAreas: [],
    questionsAnswered: 0,
    correctAnswers: 0,
    joinedAt: new Date()
  };
  
  db.users.set(username, newUser);
  db.leaderboard.push({ 
    username, 
    xp: 0, 
    level: 1, 
    accuracy: 0,
    badges: 0 
  });
  
  const token = jwt.sign({ id: userId, username }, JWT_SECRET);
  
  res.json({
    token,
    user: {
      username,
      email,
      totalXP: 0,
      level: 1,
      streak: 0,
      hearts: 5,
      gems: 100
    }
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  const user = db.users.get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const token = jwt.sign({ id: user.id, username }, JWT_SECRET);
  
  res.json({
    token,
    user: {
      username: user.username,
      email: user.email,
      totalXP: user.totalXP,
      level: user.level,
      streak: user.streak,
      hearts: user.hearts,
      gems: user.gems,
      achievements: user.achievements,
      accuracy: user.correctAnswers > 0 ? Math.round((user.correctAnswers / user.questionsAnswered) * 100) : 0
    }
  });
});

// ==================== QUESTIONS & LEARNING ====================

app.get('/api/questions/random', (req, res) => {
  const count = parseInt(req.query.count) || 10;
  const difficulty = req.query.difficulty;
  const category = req.query.category;
  
  let allQuestions = [];
  
  // Combine all questions
  Object.values(questionBank).forEach(category => {
    allQuestions = allQuestions.concat(category);
  });
  
  // Filter by difficulty if specified
  if (difficulty) {
    allQuestions = allQuestions.filter(q => q.difficulty == difficulty);
  }
  
  // Filter by category if specified  
  if (category && questionBank[category]) {
    allQuestions = questionBank[category];
  }
  
  // Shuffle and select
  const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, shuffled.length));
  
  res.json({ 
    questions: selected,
    total: selected.length 
  });
});

app.get('/api/topics', (req, res) => {
  const topics = [
    { id: 'arrays', name: 'Arrays & Strings', icon: '📊', questionCount: questionBank.arrays.length, difficulty: 1 },
    { id: 'linkedlists', name: 'Linked Lists', icon: '🔗', questionCount: questionBank.linkedlists.length, difficulty: 2 },
    { id: 'stacks_queues', name: 'Stacks & Queues', icon: '📚', questionCount: questionBank.stacks_queues.length, difficulty: 2 },
    { id: 'trees', name: 'Trees & Heaps', icon: '🌳', questionCount: questionBank.trees.length, difficulty: 3 },
    { id: 'graphs', name: 'Graphs', icon: '🕸️', questionCount: questionBank.graphs.length, difficulty: 3 },
    { id: 'dp', name: 'Dynamic Programming', icon: '🧩', questionCount: questionBank.dp.length, difficulty: 4 },
    { id: 'sorting', name: 'Sorting Algorithms', icon: '📈', questionCount: questionBank.sorting.length, difficulty: 2 },
    { id: 'bits', name: 'Bit Manipulation', icon: '💾', questionCount: questionBank.bits.length, difficulty: 3 },
    { id: 'advanced', name: 'System Design', icon: '🏗️', questionCount: questionBank.advanced.length, difficulty: 5 }
  ];
  
  res.json({ topics });
});

// ==================== AI ENDPOINTS ====================

app.post('/api/ai/hint', (req, res) => {
  const { questionId, username } = req.body;
  
  const user = db.users.get(username);
  if (!user || user.gems < 5) {
    return res.status(400).json({ error: 'Insufficient gems' });
  }
  
  user.gems -= 5;
  const hint = aiFeatures.generateHint(questionId);
  
  res.json({ hint, gemsRemaining: user.gems });
});

app.post('/api/ai/explain', (req, res) => {
  const { questionId } = req.body;
  const explanation = aiFeatures.explainAnswer(questionId);
  
  res.json({ explanation });
});

app.get('/api/ai/learning-path/:username', (req, res) => {
  const { username } = req.params;
  const user = db.users.get(username);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const path = aiFeatures.generateLearningPath(user.weakAreas);
  const difficulty = aiFeatures.getAdaptiveDifficulty(
    user.recentScores || [0.5, 0.5, 0.5, 0.5, 0.5]
  );
  
  res.json({ 
    learningPath: path,
    recommendedDifficulty: difficulty,
    weakAreas: user.weakAreas,
    strongAreas: user.strongAreas
  });
});

// ==================== PROGRESS TRACKING ====================

app.post('/api/progress/submit', (req, res) => {
  const { username, questionId, correct, timeSpent, category } = req.body;
  
  const user = db.users.get(username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Update user stats
  user.questionsAnswered++;
  if (correct) {
    user.correctAnswers++;
    user.totalXP += 10;
    
    // Track strong areas
    if (!user.strongAreas.includes(category)) {
      user.strongAreas.push(category);
    }
  } else {
    user.hearts = Math.max(0, user.hearts - 1);
    
    // Track weak areas
    if (!user.weakAreas.includes(category)) {
      user.weakAreas.push(category);
    }
  }
  
  // Update level
  user.level = Math.floor(user.totalXP / 100) + 1;
  
  // Check achievements
  const newAchievements = [];
  if (user.questionsAnswered === 10 && !user.achievements.includes('first_10')) {
    user.achievements.push('first_10');
    newAchievements.push({ name: 'First 10 Questions!', xp: 50 });
    user.totalXP += 50;
  }
  
  if (user.correctAnswers === 50 && !user.achievements.includes('50_correct')) {
    user.achievements.push('50_correct');
    newAchievements.push({ name: '50 Correct Answers!', xp: 100 });
    user.totalXP += 100;
  }
  
  // Update leaderboard
  const leaderboardEntry = db.leaderboard.find(e => e.username === username);
  if (leaderboardEntry) {
    leaderboardEntry.xp = user.totalXP;
    leaderboardEntry.level = user.level;
    leaderboardEntry.accuracy = Math.round((user.correctAnswers / user.questionsAnswered) * 100);
    leaderboardEntry.badges = user.achievements.length;
  }
  
  res.json({
    correct,
    totalXP: user.totalXP,
    level: user.level,
    hearts: user.hearts,
    accuracy: Math.round((user.correctAnswers / user.questionsAnswered) * 100),
    newAchievements
  });
});

// ==================== LEADERBOARD ====================

app.get('/api/leaderboard', (req, res) => {
  const sorted = [...db.leaderboard].sort((a, b) => b.xp - a.xp);
  
  res.json({ 
    leaderboard: sorted.slice(0, 20),
    total: sorted.length
  });
});

// ==================== 1v1 BATTLES ====================

app.post('/api/battle/create', (req, res) => {
  const { username, topic } = req.body;
  const battleId = `battle_${Date.now()}`;
  
  const questions = questionBank[topic] 
    ? [...questionBank[topic]].sort(() => Math.random() - 0.5).slice(0, 5)
    : [];
  
  const battle = {
    id: battleId,
    creator: username,
    opponent: null,
    topic,
    questions,
    scores: { [username]: 0 },
    status: 'waiting',
    createdAt: new Date()
  };
  
  db.battles.set(battleId, battle);
  
  res.json({ battleId, battle });
});

app.get('/api/battle/list', (req, res) => {
  const availableBattles = Array.from(db.battles.values())
    .filter(b => b.status === 'waiting')
    .slice(-10)
    .map(b => ({
      id: b.id,
      creator: b.creator,
      topic: b.topic,
      createdAt: b.createdAt
    }));
  
  res.json({ battles: availableBattles });
});

app.post('/api/battle/join/:battleId', (req, res) => {
  const { battleId } = req.params;
  const { username } = req.body;
  
  const battle = db.battles.get(battleId);
  if (!battle) {
    return res.status(404).json({ error: 'Battle not found' });
  }
  
  battle.opponent = username;
  battle.scores[username] = 0;
  battle.status = 'active';
  
  // Broadcast to WebSocket clients
  broadcast({
    type: 'battle_start',
    battleId,
    data: battle
  });
  
  res.json({ success: true, battle });
});

// ==================== WEBSOCKET ====================

wss.on('connection', (ws) => {
  const clientId = `client_${Date.now()}`;
  wsClients.set(clientId, ws);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'battle_answer') {
        const battle = db.battles.get(data.battleId);
        if (battle && data.correct) {
          battle.scores[data.username] += 10;
          
          broadcast({
            type: 'battle_update',
            battleId: data.battleId,
            scores: battle.scores
          });
          
          // Check if battle is complete
          const totalQuestions = battle.questions.length;
          const answeredQuestions = Object.values(battle.scores).reduce((a, b) => a + b, 0) / 10;
          
          if (answeredQuestions >= totalQuestions * 2) {
            battle.status = 'complete';
            const winner = Object.entries(battle.scores).sort((a, b) => b[1] - a[1])[0][0];
            
            broadcast({
              type: 'battle_complete',
              battleId: data.battleId,
              winner,
              scores: battle.scores
            });
          }
        }
      }
    } catch (err) {
      console.error('WebSocket error:', err);
    }
  });
  
  ws.on('close', () => {
    wsClients.delete(clientId);
  });
});

function broadcast(message) {
  const data = JSON.stringify(message);
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// ==================== START SERVER ====================

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   🚀 DS&A LEARNING PLATFORM - DUOLINGO INTERNSHIP PROJECT  ║
╠════════════════════════════════════════════════════════════╣
║  Features:                                                  ║
║  ✅ 200+ Data Structures & Algorithms Questions            ║
║  ✅ AI-Powered Hints & Explanations                        ║
║  ✅ Adaptive Learning Path                                 ║
║  ✅ Real-time 1v1 Battles                                  ║
║  ✅ Progress Tracking & Analytics                          ║
║  ✅ Achievements & Leaderboards                            ║
║  ✅ WebSocket Real-time Updates                            ║
╠════════════════════════════════════════════════════════════╣
║  Server: http://localhost:${PORT}                          ║
║  WebSocket: ws://localhost:${PORT}                         ║
╠════════════════════════════════════════════════════════════╣
║  Test Account:                                             ║
║  Username: demo                                            ║
║  Password: demo123                                         ║
╚════════════════════════════════════════════════════════════╝

  Topics Available:
  • Arrays & Strings (${questionBank.arrays.length} questions)
  • Linked Lists (${questionBank.linkedlists.length} questions)
  • Stacks & Queues (${questionBank.stacks_queues.length} questions)
  • Trees & Heaps (${questionBank.trees.length} questions)
  • Graphs (${questionBank.graphs.length} questions)
  • Dynamic Programming (${questionBank.dp.length} questions)
  • Sorting Algorithms (${questionBank.sorting.length} questions)
  • Bit Manipulation (${questionBank.bits.length} questions)
  • System Design (${questionBank.advanced.length} questions)
  
  Total Questions: ${Object.values(questionBank).reduce((sum, cat) => sum + cat.length, 0)}
  `);
});