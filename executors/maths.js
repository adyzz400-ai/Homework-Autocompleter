const SparxMaths = require('../sparx/maths');
const puppeteer = require('../sparx/puppeteer');
const fs = require('fs');
const path = require('path');

class MathsExecutor {
    constructor() {
        this.sessions = new Map();
        this.activeHomeworkSessions = new Map();
        this.homeworkCache = new Map();
    }

    async executeLogin(school, username, password) {
        try {
            const { token, session_id } = await puppeteer.login(school, username, password);
            
            const session = new SparxMaths(school, username, password, token, session_id);
            const sessionId = `sparx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            this.sessions.set(sessionId, session);
            
            // Validate session
            const isValid = await session.validateSession();
            
            return {
                success: true,
                sessionId,
                token,
                session_id,
                isValid
            };
        } catch (error) {
            console.error('Login error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getHomeworkList(sessionId, includeCompleted = false) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        
        try {
            const homeworkList = await session.getHomeworkList(includeCompleted);
            
            // Fix: Handle missing endDate fields safely
            const sortedList = homeworkList.sort((a, b) => {
                // Handle missing dates by treating them as far future
                const dateA = a.dueDate ? new Date(a.dueDate) : new Date('9999-12-31');
                const dateB = b.dueDate ? new Date(b.dueDate) : new Date('9999-12-31');
                
                // Handle invalid dates
                if (isNaN(dateA.getTime())) return 1;
                if (isNaN(dateB.getTime())) return -1;
                
                return dateA - dateB;
            });
            
            return sortedList;
        } catch (error) {
            console.error('Error getting homework list:', error);
            
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                // Try to refresh session
                const refreshed = await this.refreshSession(sessionId);
                if (refreshed) {
                    return await this.getHomeworkList(sessionId, includeCompleted);
                }
            }
            
            throw error;
        }
    }

    async startHomework(sessionId, packageId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        
        try {
            const homeworkSession = await session.startHomeworkSession(packageId);
            const homeworkSessionId = homeworkSession.sessionId;
            
            this.activeHomeworkSessions.set(homeworkSessionId, {
                sparxSessionId: sessionId,
                session: homeworkSession,
                packageId
            });
            
            // Get initial task
            const currentTask = session.getCurrentTask(homeworkSessionId);
            const progress = session.getHomeworkProgress(homeworkSessionId);
            
            return {
                success: true,
                homeworkSessionId,
                packageId,
                currentTask,
                progress,
                message: `Started homework: ${currentTask.assignmentTitle}`
            };
        } catch (error) {
            console.error('Error starting homework:', error);
            throw error;
        }
    }

    async getCurrentHomeworkTask(homeworkSessionId) {
        const homeworkData = this.activeHomeworkSessions.get(homeworkSessionId);
        if (!homeworkData) {
            throw new Error('Homework session not found');
        }
        
        const session = this.sessions.get(homeworkData.sparxSessionId);
        if (!session) {
            throw new Error('Sparx session not found');
        }
        
        const currentTask = session.getCurrentTask(homeworkSessionId);
        if (!currentTask) {
            // Check if homework is complete
            const sessionData = session.homeworkSessions.get(homeworkSessionId);
            if (sessionData && sessionData.completed) {
                return {
                    completed: true,
                    message: 'Homework completed!',
                    session: sessionData
                };
            }
            throw new Error('No current task available');
        }
        
        const progress = session.getHomeworkProgress(homeworkSessionId);
        
        return {
            success: true,
            currentTask,
            progress,
            homeworkSessionId
        };
    }

    async submitHomeworkAnswer(homeworkSessionId, answer) {
        const homeworkData = this.activeHomeworkSessions.get(homeworkSessionId);
        if (!homeworkData) {
            throw new Error('Homework session not found');
        }
        
        const session = this.sessions.get(homeworkData.sparxSessionId);
        if (!session) {
            throw new Error('Sparx session not found');
        }
        
        try {
            const result = await session.submitAnswer(homeworkSessionId, answer);
            
            // Update cache
            this.homeworkCache.delete(`progress_${homeworkSessionId}`);
            
            return result;
        } catch (error) {
            console.error('Error submitting answer:', error);
            
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                const refreshed = await this.refreshSession(homeworkData.sparxSessionId);
                if (refreshed) {
                    return await this.submitHomeworkAnswer(homeworkSessionId, answer);
                }
            }
            
            throw error;
        }
    }

    async getHomeworkDashboard(homeworkSessionId) {
        const homeworkData = this.activeHomeworkSessions.get(homeworkSessionId);
        if (!homeworkData) {
            throw new Error('Homework session not found');
        }
        
        const session = this.sessions.get(homeworkData.sparxSessionId);
        if (!session) {
            throw new Error('Sparx session not found');
        }
        
        // Check cache first
        const cacheKey = `dashboard_${homeworkSessionId}`;
        const cached = this.homeworkCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp < 5000)) { // 5 second cache for dashboard
            return cached.data;
        }
        
        const dashboard = session.getHomeworkDashboard(homeworkSessionId);
        if (!dashboard) {
            return {
                error: 'No active homework session',
                sessionId: homeworkSessionId
            };
        }
        
        // Format for Discord embed
        const formattedDashboard = this.formatDashboardForDiscord(dashboard, session, homeworkSessionId);
        
        // Cache the result
        this.homeworkCache.set(cacheKey, {
            data: formattedDashboard,
            timestamp: Date.now()
        });
        
        return formattedDashboard;
    }

    formatDashboardForDiscord(dashboard, session, homeworkSessionId) {
        const progressBar = this.createProgressBar(dashboard.progress, 15);
        const dueDateStr = dashboard.dueDate ? 
            new Date(dashboard.dueDate).toLocaleDateString('en-GB', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            }) : 
            'No due date';
        
        const timeSpentMinutes = Math.floor(dashboard.timeSpent / 60);
        const timeSpentSeconds = dashboard.timeSpent % 60;
        
        // Get current task details
        const currentTask = session.getCurrentTask(homeworkSessionId);
        const questionText = currentTask ? 
            (currentTask.question.length > 150 ? 
                currentTask.question.substring(0, 150) + '...' : 
                currentTask.question) : 
            'No current task';
        
        return {
            title: `📚 ${dashboard.title || 'Sparx Homework'}`,
            description: `**Homework Progress** • Session: \`${dashboard.sessionId.substring(0, 12)}\``,
            color: this.getProgressColor(dashboard.progress),
            fields: [
                {
                    name: '📅 Due Date',
                    value: `\`${dueDateStr}\``,
                    inline: true
                },
                {
                    name: '⏱️ Time Spent',
                    value: `\`${timeSpentMinutes}m ${timeSpentSeconds}s\``,
                    inline: true
                },
                {
                    name: '🎯 Current Task',
                    value: `\`${dashboard.currentQuestion}\``,
                    inline: true
                },
                {
                    name: '📊 Progress',
                    value: `\`${progressBar}\` ${dashboard.progress}%`,
                    inline: false
                },
                {
                    name: '✅ Completed',
                    value: `\`${dashboard.completedTasks}/${dashboard.totalTasks}\` tasks`,
                    inline: true
                },
                {
                    name: '📝 Question',
                    value: `\`\`\`${questionText}\`\`\``,
                    inline: false
                },
                {
                    name: '🔖 Bookwork Code',
                    value: `\`${dashboard.currentTask?.bookworkCode || 'None'}\``,
                    inline: true
                },
                {
                    name: '🎯 Type',
                    value: `\`${dashboard.currentTask?.type || 'Unknown'}\``,
                    inline: true
                }
            ],
            footer: {
                text: `Vobo Ai • Homework Autocompleter • ${new Date().toLocaleTimeString()}`
            },
            timestamp: new Date().toISOString()
        };
    }

    createProgressBar(percentage, length) {
        const filledLength = Math.round((percentage / 100) * length);
        const emptyLength = length - filledLength;
        
        const filledBar = '█'.repeat(filledLength);
        const emptyBar = '░'.repeat(emptyLength);
        
        return `${filledBar}${emptyBar}`;
    }

    getProgressColor(percentage) {
        if (percentage >= 80) return 0x00FF00; // Green
        if (percentage >= 50) return 0xFFA500; // Orange
        if (percentage >= 25) return 0xFFFF00; // Yellow
        return 0xFF0000; // Red
    }

    async refreshSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        
        try {
            // Try to validate the current session
            const isValid = await session.validateSession();
            if (isValid) return true;
            
            // If invalid, try to refresh
            const refreshed = await session.refreshSession();
            return refreshed;
        } catch (error) {
            console.error('Session refresh error:', error);
            return false;
        }
    }

    async cancelHomework(homeworkSessionId) {
        const homeworkData = this.activeHomeworkSessions.get(homeworkSessionId);
        if (!homeworkData) {
            throw new Error('Homework session not found');
        }
        
        const session = this.sessions.get(homeworkData.sparxSessionId);
        if (!session) {
            throw new Error('Sparx session not found');
        }
        
        const cancelled = session.cancelHomeworkSession(homeworkSessionId);
        
        if (cancelled) {
            this.activeHomeworkSessions.delete(homeworkSessionId);
            this.homeworkCache.delete(`dashboard_${homeworkSessionId}`);
            this.homeworkCache.delete(`progress_${homeworkSessionId}`);
        }
        
        return cancelled;
    }

    async listActiveHomeworkSessions(sparxSessionId = null) {
        const activeSessions = [];
        
        for (const [homeworkSessionId, homeworkData] of this.activeHomeworkSessions) {
            if (sparxSessionId && homeworkData.sparxSessionId !== sparxSessionId) {
                continue;
            }
            
            const session = this.sessions.get(homeworkData.sparxSessionId);
            if (session) {
                const progress = session.getHomeworkProgress(homeworkSessionId);
                const currentTask = session.getCurrentTask(homeworkSessionId);
                
                activeSessions.push({
                    homeworkSessionId,
                    sparxSessionId: homeworkData.sparxSessionId,
                    packageId: homeworkData.packageId,
                    progress,
                    currentTask: currentTask ? {
                        assignmentTitle: currentTask.assignmentTitle,
                        question: currentTask.question.substring(0, 50) + '...'
                    } : null,
                    startTime: homeworkData.session.startTime
                });
            }
        }
        
        return activeSessions;
    }

    async getHomeworkStatistics(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        
        const homeworkList = await this.getHomeworkList(sessionId, true);
        
        let totalAssignments = 0;
        let totalTasks = 0;
        let completedTasks = 0;
        let overdueCount = 0;
        
        const now = new Date();
        
        for (const homework of homeworkList) {
            totalAssignments++;
            totalTasks += homework.totalTasks || 0;
            completedTasks += homework.completedTasks || 0;
            
            if (homework.dueDate && new Date(homework.dueDate) < now && homework.progress < 100) {
                overdueCount++;
            }
        }
        
        const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
        
        return {
            totalAssignments,
            totalTasks,
            completedTasks,
            remainingTasks: totalTasks - completedTasks,
            completionRate: Math.round(completionRate),
            overdueAssignments: overdueCount,
            activeSessions: this.listActiveHomeworkSessions(sessionId).length
        };
    }

    async cleanupExpiredSessions() {
        const now = Date.now();
        const expiredTime = 30 * 60 * 1000; // 30 minutes
        
        // Clean up Sparx sessions
        for (const [sessionId, session] of this.sessions) {
            if (session.sessionExpiry && now > session.sessionExpiry) {
                this.sessions.delete(sessionId);
                console.log(`Cleaned up expired Sparx session: ${sessionId}`);
            }
        }
        
        // Clean up homework sessions
        for (const [homeworkSessionId, homeworkData] of this.activeHomeworkSessions) {
            const session = this.sessions.get(homeworkData.sparxSessionId);
            if (!session || !session.homeworkSessions.has(homeworkSessionId)) {
                this.activeHomeworkSessions.delete(homeworkSessionId);
                console.log(`Cleaned up orphaned homework session: ${homeworkSessionId}`);
            }
        }
        
        // Clean up cache
        for (const [cacheKey, cacheData] of this.homeworkCache) {
            if (now - cacheData.timestamp > 3600000) { // 1 hour
                this.homeworkCache.delete(cacheKey);
            }
        }
    }
}

module.exports = new MathsExecutor();