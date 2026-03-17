
"use client"

import { useState, useEffect } from "react";
import { DashboardClient } from "./dashboard-client";
import { ConsoleToggle } from "@/components/console-toggle";
// import { getStreamMetrics, type StreamMetrics } from "@/ai/flows/get-stream-metrics";
// import { syncStreamMetrics } from "@/ai/flows/sync-stream-metrics";
type StreamMetrics = { totalCommands: number; shoutoutsGiven: number; athenaCommands: number; lurkCommands: number; };

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";


export default function DashboardPage() {
    const { toast } = useToast();
    const [viewers, setViewers] = useState<any[]>([]);
    const [metrics, setMetrics] = useState<StreamMetrics | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [selectedPlatform, setSelectedPlatform] = useState('Twitch');

    const fetchAllData = async () => {
        setIsLoading(true);
        try {
            let viewersResult = [];
            
            // Fetch different data based on selected platform
            if (selectedPlatform === 'Discord') {
                // Fetch Discord voice members from Dyno logs
                const dynoResponse = await fetch('/api/discord/dyno-voice');
                if (dynoResponse.ok) {
                    viewersResult = await dynoResponse.json();
                } else {
                    const errorData = await dynoResponse.json();
                    throw new Error(errorData.error || 'Failed to parse Dyno logs');
                }
            } else {
                // Fetch Twitch chatters via API
                const chattersResponse = await fetch('/api/chat/chatters');
                if (chattersResponse.ok) {
                    const data = await chattersResponse.json();
                    viewersResult = data.chatters || [];
                } else {
                    const errorData = await chattersResponse.json().catch(() => ({ error: 'Unknown error' }));
                    console.warn('Chatters API failed:', errorData);
                    // Continue with empty array instead of throwing
                    viewersResult = [];
                }
            }
            
            const metricsResult = { metrics: { totalCommands: 0, shoutoutsGiven: 0, athenaCommands: 0, lurkCommands: 0 } };

            // For Twitch, fetch user details for each chatter to get avatars
            let fetchedViewers = [];
            if (selectedPlatform !== 'Discord') {
                fetchedViewers = await Promise.all(
                    viewersResult.map(async (chatter: any, index: number) => {
                        let avatar = "https://placehold.co/40x40.png";
                        let displayName = chatter.user_display_name || chatter.user_login || 'Unknown User';
                        
                        // Try to get user details from Twitch API
                        try {
                            const baseUrl = process.env.NEXT_PUBLIC_STREAMWEAVE_URL || 'http://localhost:3100';
                            const userResponse = await fetch(`${baseUrl}/api/twitch/user?login=${chatter.user_login}`);
                            if (userResponse.ok) {
                                const userData = await userResponse.json();
                                if (userData.profileImageUrl) {
                                    avatar = userData.profileImageUrl;
                                }
                                if (userData.displayName) {
                                    displayName = userData.displayName;
                                }
                            }
                        } catch (error) {
                            console.warn(`Failed to fetch user details for ${chatter.user_login}:`, error);
                        }
                        
                        return {
                            id: chatter.user_id || (index + 1).toString(),
                            name: displayName,
                            platform: "Twitch",
                            active: true,
                            avatar,
                            watchTime: "N/A",
                            followDate: null,
                            isSub: false,
                            subMonths: 0,
                            bits: 0,
                            commandsRun: 0,
                            shoutouts: 0,
                            lastSeen: new Date().toISOString()
                        };
                    })
                );
            } else {
                // Discord members already have the correct format
                fetchedViewers = viewersResult;
            }

            setViewers(fetchedViewers);
            setMetrics(metricsResult.metrics);

        } catch (error: any) {
            console.error("[Dashboard Page] Failed to fetch live data:", error);
            toast({
                variant: "destructive",
                title: "Failed to load dashboard data",
                description: error.message || "Please check the server logs and your .env configuration."
            });
            // Set empty state on error
            setViewers([]);
            setMetrics({ totalCommands: 0, shoutoutsGiven: 0, athenaCommands: 0, lurkCommands: 0 });
        } finally {
            setIsLoading(false);
        }
    };
    
    useEffect(() => {
        fetchAllData();
    }, [toast, selectedPlatform]);

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            // const result = await syncStreamMetrics();
            toast({
                title: "Metrics Synced! (Mock)",
                description: "AI features disabled for testing."
            });
            // Mock metrics
            setMetrics({ totalCommands: 0, shoutoutsGiven: 0, athenaCommands: 0, lurkCommands: 0 });
        } catch (error: any) {
             toast({
                variant: "destructive",
                title: "Sync Failed",
                description: error.message || "Could not save metrics to Discord."
            });
        } finally {
            setIsSyncing(false);
        }
    }


    const allMetrics = [
        { id: 'totalCommands', title: 'Total Commands Executed', value: metrics?.totalCommands.toLocaleString() || '0', description: 'Across all commands', icon: 'MessageSquare' },
        { id: 'shoutoutsGiven', title: 'Shoutouts Given', value: metrics?.shoutoutsGiven.toLocaleString() || '0', description: '!so command usage', icon: 'Sparkles' },
        { id: 'activeViewers', title: 'Live Viewers', value: viewers.length.toLocaleString(), description: 'Currently in chat', icon: 'Users' },
        { id: 'athenaCommands', title: 'Athena Interactions', value: metrics?.athenaCommands.toLocaleString() || '0', description: '!athena command usage', icon: 'Bot' },
    ];


    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <LoaderCircle className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
             <div className="flex justify-between items-center">
                <ConsoleToggle />
                <div className="flex gap-2">
                    <Button onClick={handleSync} disabled={isSyncing || isLoading} variant="outline">
                        {isSyncing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Sync Metrics
                    </Button>
                </div>
            </div>

            <DashboardClient allMetrics={allMetrics} allViewers={viewers} selectedPlatform={selectedPlatform} setSelectedPlatform={setSelectedPlatform} />
        </div>
    );
}
