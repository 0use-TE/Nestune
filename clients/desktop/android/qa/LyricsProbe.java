package net.ouse.nestune.probe;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.Instrumentation.ActivityMonitor;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Ephemeral emulator-only instrumentation. No account or server writes. */
public class LyricsProbe extends Instrumentation {
    private Activity activity; private WebView web; private boolean permissionOnly;
    @Override public void onCreate(Bundle args) { super.onCreate(args); permissionOnly=args!=null && "permission".equals(args.getString("mode")); start(); }
    private WebView find(View view) {
        if(view instanceof WebView)return (WebView)view;
        if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){WebView result=find(((ViewGroup)view).getChildAt(i));if(result!=null)return result;}
        return null;
    }
    private String js(String code) throws Exception {
        CountDownLatch ready=new CountDownLatch(1);String[] result={null};
        runOnMainSync(()->web.evaluateJavascript(code,value->{result[0]=value;ready.countDown();}));
        if(!ready.await(12,TimeUnit.SECONDS))throw new AssertionError("JS response timed out");return result[0];
    }
    private void expect(String code) throws Exception {
        for(int i=0;i<240;i++){if("true".equals(js(code)))return;SystemClock.sleep(150);}throw new AssertionError(code);
    }
    private void post(JSONObject data) throws Exception {js("NestuneNative.postMessage("+JSONObject.quote(data.toString())+");true");}
    private JSONObject request(JSONObject data) throws Exception {
        String id="q"+System.nanoTime();data.put("requestId",id);post(data);
        expect("!!window.__lyricsReplies["+JSONObject.quote(id)+"]");
        return new JSONObject(js("window.__lyricsReplies["+JSONObject.quote(id)+"]"));
    }
    private AccessibilityNodeInfo search(AccessibilityNodeInfo node,String text) {
        if(node==null)return null;if(node.getText()!=null && text.contentEquals(node.getText()))return node;
        for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=search(node.getChild(i),text);if(found!=null)return found;}return null;
    }
    private AccessibilityNodeInfo visible(String text) {
        for(AccessibilityWindowInfo window:getUiAutomation().getWindows()){AccessibilityNodeInfo found=search(window.getRoot(),text);if(found!=null)return found;}return null;
    }
    private Rect waitText(String text) throws Exception {
        for(int i=0;i<60;i++){AccessibilityNodeInfo node=visible(text);if(node!=null){Rect result=new Rect();node.getBoundsInScreen(result);return result;}SystemClock.sleep(150);}
        throw new AssertionError("Overlay text absent: "+text);
    }
    private void pointer(int action,float x,float y,long down,long at) {sendPointerSync(MotionEvent.obtain(down,at,action,x,y,0));}
    private void tap(Rect rect){long t=SystemClock.uptimeMillis();pointer(MotionEvent.ACTION_DOWN,rect.centerX(),rect.centerY(),t,t);pointer(MotionEvent.ACTION_UP,rect.centerX(),rect.centerY(),t,t+100);}
    private JSONObject type(String value)throws Exception{return new JSONObject().put("type",value);}
    @Override public void onStart() {
        Bundle result=new Bundle();
        try {
            activity=startActivitySync(new Intent().setClassName("net.ouse.nestune","net.ouse.nestune.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            for(int i=0;i<80&&web==null;i++){runOnMainSync(()->web=find(activity.getWindow().getDecorView()));SystemClock.sleep(150);}
            if(web==null)throw new AssertionError("Missing WebView");
            expect("location.origin==='https://music.0use.net' && document.readyState==='complete' && typeof NestuneNative!=='undefined'");
            js("window.__lyricsReplies={};const old=NestuneNative.onmessage;NestuneNative.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.requestId)window.__lyricsReplies[d.requestId]=d}catch{};old?.(e)};window.__overlayEvents=[];window.addEventListener('nt:lyrics-state',e=>__overlayEvents.push(e.detail));true");
            ActivityMonitor prompt=addMonitor(new IntentFilter(Settings.ACTION_MANAGE_OVERLAY_PERMISSION),null,true);
            JSONObject state=request(type("lyricsInfo"));
            if(!state.optBoolean("supported"))throw new AssertionError("Unsupported native bridge");
            if(prompt.getHits()!=0)throw new AssertionError("Permission requested without user action");
            if(permissionOnly){
                if(state.optBoolean("permission"))throw new AssertionError("Permission fixture was not reset");
                state=request(type("lyricsEnable").put("enabled",true));
                boolean permissionScreen=prompt.getHits()>0;
                for(int i=0;i<30&&!permissionScreen;i++){
                    AccessibilityNodeInfo top=getUiAutomation().getRootInActiveWindow();
                    permissionScreen=top!=null && "com.android.settings".contentEquals(top.getPackageName());
                    if(!permissionScreen)SystemClock.sleep(100);
                }
                if(state.optBoolean("enabled")||state.optBoolean("permission")||!permissionScreen)throw new AssertionError("Wrong permission-request flow: "+state);
                removeMonitor(prompt);result.putString("report","NESTUNE_LYRICS_PERMISSION_PASS: explicit action opens overlay permission; no automatic prompt");finish(Activity.RESULT_OK,result);return;
            }
            removeMonitor(prompt);if(!state.optBoolean("permission"))throw new AssertionError("Overlay fixture permission absent");
            AccessibilityServiceInfo service=getUiAutomation().getServiceInfo();service.flags|=AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;getUiAutomation().setServiceInfo(service);
            state=request(type("lyricsEnable").put("enabled",true));if(!state.optBoolean("enabled"))throw new AssertionError("Overlay did not enable");
            JSONObject data=new JSONObject("{\"type\":\"lyricsData\",\"id\":\"qa\",\"title\":\"Nestune QA\",\"plainText\":\"\",\"lines\":[{\"t\":0,\"text\":\"Native first line\",\"tr\":\"Translation one\"},{\"t\":2,\"text\":\"Native second line\",\"tr\":\"Translation two\"},{\"t\":4,\"text\":\"Native third line\"}]}");
            post(data);post(type("lyricsMedia").put("id","qa").put("position",0).put("playing",true));waitText("Native first line");
            post(new JSONObject("{\"type\":\"media\",\"id\":\"qa\",\"title\":\"Nestune QA\",\"artist\":\"QA\",\"duration\":60,\"position\":0,\"playing\":true}"));
            activity.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitText("Native second line");waitText("Native third line");
            post(type("lyricsMedia").put("id","qa").put("position",2.2).put("playing",false));waitText("Native second line");SystemClock.sleep(2300);waitText("Native second line");waitText("Translation two");
            post(type("lyricsMedia").put("id","qa").put("position",0.1).put("playing",false));Rect before=waitText("Native first line");
            long t=SystemClock.uptimeMillis();pointer(MotionEvent.ACTION_DOWN,before.centerX(),before.centerY(),t,t);SystemClock.sleep(150);
            pointer(MotionEvent.ACTION_MOVE,before.centerX()+50,before.centerY()-90,t,t+180);pointer(MotionEvent.ACTION_UP,before.centerX()+50,before.centerY()-90,t,t+260);
            SystemClock.sleep(300);Rect after=waitText("Native first line");if(after.centerY()>=before.centerY()-20)throw new AssertionError("Dragging did not move overlay");
            state=request(type("lyricsLock").put("locked",true));if(!state.optBoolean("locked"))throw new AssertionError("Lock failed");
            state=request(type("lyricsLock").put("locked",false));if(state.optBoolean("locked"))throw new AssertionError("Unlock failed");
            getUiAutomation().setRotation(Surface.ROTATION_90);SystemClock.sleep(1000);Rect rotated=waitText("Native first line");
            int width=getTargetContext().getResources().getDisplayMetrics().widthPixels;if(rotated.left<0||rotated.right>width+2)throw new AssertionError("Rotated lyrics outside display");
            getUiAutomation().setRotation(Surface.ROTATION_0);SystemClock.sleep(700);
            tap(waitText("Native first line"));tap(waitText("关闭"));SystemClock.sleep(400);
            state=request(type("lyricsInfo"));if(state.optBoolean("enabled")||visible("Native first line")!=null)throw new AssertionError("Close failed");
            expect("window.__overlayEvents.some(e=>e.enabled===false)");
            js("const f=document.createElement('iframe');f.srcdoc='<script>setTimeout(()=>window.NestuneNative?.postMessage(JSON.stringify({type:\"lyricsEnable\",enabled:true})),20)<\\/script>';document.body.append(f);true");SystemClock.sleep(350);
            if(request(type("lyricsInfo")).optBoolean("enabled"))throw new AssertionError("Child frame controlled the overlay");
            post(new JSONObject("{\"type\":\"media\",\"id\":\"\"}"));
            result.putString("report","NESTUNE_LYRICS_RUNTIME_PASS: real native overlay over launcher, independent background clock, pause, seek, translation, drag, lock/unlock, rotation, native close event, child-frame denial; no login or server writes");finish(Activity.RESULT_OK,result);
        } catch(Throwable error){result.putString("failure",error.toString());try{result.putString("page",js("({url:location.href,ready:document.readyState,native:typeof NestuneNative})"));}catch(Exception ignored){}error.printStackTrace();finish(Activity.RESULT_CANCELED,result);}
        finally {getUiAutomation().setRotation(Surface.ROTATION_0);}
    }
}
