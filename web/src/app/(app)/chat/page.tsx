'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loading } from '@/components/Loading';
export default function ChatPage(){return <Suspense fallback={<Loading/>}><LegacyChat/></Suspense>;}
function LegacyChat(){const router=useRouter();const params=useSearchParams();useEffect(()=>{router.replace(`/social${params.toString()?'?'+params.toString():''}`);},[router,params]);return <Loading/>;}
