package net.ouse.nestune.probe;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class Probe extends Instrumentation {
    private WebView web;
    private Activity activity;
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    private WebView find(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) for (int i=0; i<((ViewGroup)view).getChildCount(); i++) {
            WebView found=find(((ViewGroup)view).getChildAt(i)); if (found!=null) return found;
        }
        return null;
    }
    private String js(String script) throws Exception {
        CountDownLatch latch=new CountDownLatch(1); String[] value={null};
        runOnMainSync(() -> web.evaluateJavascript(script, result -> { value[0]=result; latch.countDown(); }));
        if (!latch.await(10,TimeUnit.SECONDS)) throw new AssertionError("WebView JS timed out");
        return value[0];
    }
    private void expectJS(String expression) throws Exception {
        for (int i=0;i<120;i++) { if ("true".equals(js(expression))) return; SystemClock.sleep(500); }
        throw new AssertionError("Condition failed: "+expression);
    }
    private MediaController controller() throws Exception {
        MediaSessionManager manager=getTargetContext().getSystemService(MediaSessionManager.class);
        for (int i=0;i<30;i++) {
            for (MediaController c:manager.getActiveSessions(null)) if (c.getPackageName().equals("net.ouse.nestune")) return c;
            SystemClock.sleep(100);
        }
        throw new AssertionError("Native media session not published");
    }
    @Override public void onStart() {
        Bundle result=new Bundle();
        try {
            activity=startActivitySync(new Intent().setClassName("net.ouse.nestune","net.ouse.nestune.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            for (int i=0;i<40;i++) { runOnMainSync(() -> web=find(activity.getWindow().getDecorView())); if (web!=null) break; SystemClock.sleep(250); }
            if (web==null) throw new AssertionError("No native WebView");
            expectJS("location.origin==='https://music.0use.net' && document.readyState==='complete' && !!document.querySelector('#login,#app')");
            expectJS("typeof NestuneNative !== 'undefined'");
            js("window.__originalBack=window.__nestuneBack;window.__probeBack=false;window.__nestuneBack=()=>{window.__probeBack=true;return true};true");
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            expectJS("window.__probeBack===true");
            if (activity.isFinishing()) throw new AssertionError("Back closed the native activity");
            js("window.__nestuneBack=window.__originalBack;window.__probeEvents=[];window.addEventListener('nt:media',e=>window.__probeEvents.push(e.detail));NestuneNative.postMessage(JSON.stringify({type:'media',id:'probe',title:'Nestune Android probe',artist:'QA',album:'QA',duration:60,position:3,playing:true}));true");
            getUiAutomation().adoptShellPermissionIdentity("android.permission.MEDIA_CONTENT_CONTROL");
            MediaController media=controller();
            if (media.getPlaybackState().getState()!=PlaybackState.STATE_PLAYING) throw new AssertionError("Wrong native playback state");
            if (!"Nestune Android probe".equals(media.getMetadata().getDescription().getTitle().toString())) throw new AssertionError("Wrong notification title");
            media.getTransportControls().pause(); expectJS("window.__probeEvents.some(e=>e.action==='pause')");
            media.getTransportControls().skipToNext(); expectJS("window.__probeEvents.some(e=>e.action==='next')");
            media.getTransportControls().seekTo(9000); expectJS("window.__probeEvents.some(e=>e.action==='seek'&&e.position===9)");
            js("NestuneNative.postMessage(JSON.stringify({type:'media',id:''}));true");
            result.putString("report","NESTUNE_ANDROID_PASS: production HTTPS startup, main-frame bridge, hardware back interception, native MediaSession title/state, pause/next/seek callbacks");
            finish(Activity.RESULT_OK,result);
        } catch (Throwable error) {
            result.putString("failure",error.toString()); error.printStackTrace(); finish(Activity.RESULT_CANCELED,result);
        } finally { getUiAutomation().dropShellPermissionIdentity(); }
    }
}
