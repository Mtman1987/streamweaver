'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Send, Bot, User, Code, Zap, Sparkles } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  automation?: any;
  codeSnippets?: Array<{ code: string; language: string; description: string }>;
  suggestedChanges?: any;
}

interface AutomationAIChatProps {
  currentWorkflow?: any;
  onAutomationGenerated?: (automation: any) => void;
  onCodeGenerated?: (code: string, language: string) => void;
  userName?: string;
}

export default function AutomationAIChat({
  currentWorkflow,
  onAutomationGenerated,
  onCodeGenerated,
  userName = 'User'
}: AutomationAIChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: 'Hi! I\'m your StreamWeaver AI assistant. I can help you:\n\n• **Build automations** - Just describe what you want\n• **Generate code** - Ask me to write C#, JavaScript, or Python\n• **Explain features** - Ask about any sub-action or trigger\n• **Modify workflows** - Tell me what to change\n\nTry: "Create an automation that thanks new followers" or "Generate code to get the current time"',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // Scroll to bottom when new message added
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);
  
  const detectIntent = (message: string): 'build' | 'code' | 'chat' => {
    const lower = message.toLowerCase();
    
    // Code generation keywords
    if (
      lower.includes('generate code') ||
      lower.includes('write code') ||
      lower.includes('create code') ||
      lower.includes('code for') ||
      lower.includes('c# code') ||
      lower.includes('javascript code') ||
      lower.includes('python code')
    ) {
      return 'code';
    }
    
    // Automation building keywords
    if (
      lower.includes('create automation') ||
      lower.includes('build automation') ||
      lower.includes('make automation') ||
      lower.includes('create action') ||
      lower.includes('build action') ||
      lower.includes('when') && (lower.includes('then') || lower.includes('do'))
    ) {
      return 'build';
    }
    
    return 'chat';
  };
  
  const handleSendMessage = async () => {
    if (!input.trim() || isProcessing) return;
    
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);
    
    try {
      const intent = detectIntent(input);
      let assistantMessage: Message;
      
      if (intent === 'build') {
        // Build automation - placeholder
        assistantMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Automation building is not yet implemented. This feature will be available in a future update.',
          timestamp: new Date()
        };
      } else if (intent === 'code') {
        // Code generation - placeholder
        assistantMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Code generation is not yet implemented. This feature will be available in a future update.',
          timestamp: new Date()
        };
      } else {
        // General chat - placeholder
        assistantMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'I\'m here to help with StreamWeaver automations! While some features are still in development, feel free to ask questions about the platform.',
          timestamp: new Date()
        };
      }
      
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('AI chat error:', error);
      const message = error instanceof Error ? error.message : String(error);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${message}`,
        timestamp: new Date()
      }]);
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  const renderMessage = (message: Message) => {
    const isUser = message.role === 'user';
    
    return (
      <div key={message.id} className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser ? 'bg-blue-500' : 'bg-purple-500'
        }`}>
          {isUser ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
        </div>
        
        <div className={`flex-1 ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-2`}>
          <div className={`rounded-lg p-3 max-w-[80%] ${
            isUser 
              ? 'bg-blue-500 text-white ml-auto' 
              : 'bg-gray-100 dark:bg-gray-800'
          }`}>
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
          
          {message.automation && (
            <Card className="max-w-[80%]">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  <CardTitle className="text-sm">{message.automation.name}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">Triggers:</span> {message.automation.triggers.length}
                  </div>
                  <div>
                    <span className="font-medium">Sub-Actions:</span> {message.automation.subActions.length}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onAutomationGenerated?.(message.automation)}
                    className="w-full mt-2"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Apply This Automation
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          
          {message.codeSnippets && message.codeSnippets.length > 0 && (
            <div className="max-w-[80%] space-y-2">
              {message.codeSnippets.map((snippet, index) => (
                <Card key={index}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Code className="w-4 h-4" />
                        <Badge variant="outline">{snippet.language}</Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(snippet.code);
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
                      <code>{snippet.code}</code>
                    </pre>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          
          <span className="text-xs text-gray-500">
            {message.timestamp.toLocaleTimeString()}
          </span>
        </div>
      </div>
    );
  };
  
  return (
    <Card className="flex flex-col h-[600px]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-purple-500" />
          AI Automation Assistant
        </CardTitle>
        <CardDescription>
          Build automations with natural language
        </CardDescription>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden">
        <ScrollArea ref={scrollAreaRef} className="flex-1 pr-4">
          <div className="space-y-4">
            {messages.map(renderMessage)}
            
            {isProcessing && (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white animate-pulse" />
                </div>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Describe what you want to build..."
            disabled={isProcessing}
            className="flex-1"
          />
          <Button 
            onClick={handleSendMessage} 
            disabled={!input.trim() || isProcessing}
            size="icon"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInput("Create an automation that thanks new followers")}
            disabled={isProcessing}
          >
            Example: Thank followers
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInput("Generate C# code to get the current time")}
            disabled={isProcessing}
          >
            Example: Generate code
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
