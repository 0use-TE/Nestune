package net.ouse.nestune.probe;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.Instrumentation.ActivityMonitor;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
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
import java.util.Arrays;
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
    private String describe(AccessibilityNodeInfo node) {
        if(node==null)return "";String value=node.getText()==null?"":node.getText().toString()+"|";
        for(int i=0;i<node.getChildCount();i++)value+=describe(node.getChild(i));return value;
    }
    private AccessibilityNodeInfo visible(String text) {
        for(AccessibilityWindowInfo window:getUiAutomation().getWindows()){AccessibilityNodeInfo found=search(window.getRoot(),text);if(found!=null)return found;}return null;
    }
    private Rect nativeTextBounds(String text) {
        try {
            Class<?> c=Class.forName("net.ouse.nestune.LyricsOverlay");Object instance=null;
            for(java.lang.reflect.Field f:c.getDeclaredFields())if(java.lang.reflect.Modifier.isStatic(f.getModifiers())&&f.getType()==c){f.setAccessible(true);instance=f.get(null);}
            for(java.lang.reflect.Field f:c.getDeclaredFields()){
                f.setAccessible(true);Object value=f.get(instance);
                if(value instanceof android.widget.TextView){android.widget.TextView view=(android.widget.TextView)value;if(text.contentEquals(view.getText())&&view.isShown()){Rect[] rect={null};runOnMainSync(()->{int[] at=new int[2];view.getLocationOnScreen(at);rect[0]=new Rect(at[0],at[1],at[0]+view.getWidth(),at[1]+view.getHeight());});return rect[0];}}
            }
        }catch(Exception ignored){}return null;
    }
    private Rect waitText(String text) throws Exception {
        for(int i=0;i<60;i++){AccessibilityNodeInfo node=visible(text);if(node!=null){Rect result=new Rect();node.getBoundsInScreen(result);return result;}Rect nativeBounds=nativeTextBounds(text);if(nativeBounds!=null)return nativeBounds;SystemClock.sleep(150);}
        throw new AssertionError("Overlay text absent: "+text);
    }
    private boolean[] glyphMask(Rect bounds) {
        Bitmap screenshot = getUiAutomation().takeScreenshot();
        if (screenshot == null) throw new AssertionError("Overlay screenshot unavailable");
        try {
            Rect crop = new Rect(bounds);
            if (!crop.intersect(0, 0, screenshot.getWidth(), screenshot.getHeight()))
                throw new AssertionError("Overlay outside the screenshot: " + bounds);
            int[] pixels = new int[crop.width() * crop.height()];
            screenshot.getPixels(pixels, 0, crop.width(), crop.left, crop.top, crop.width(), crop.height());
            boolean[] mask = new boolean[pixels.length];
            for (int i = 0; i < pixels.length; i++) mask[i] = ((pixels[i] >> 8) & 255) > 120;
            return mask;
        } finally {
            screenshot.recycle();
        }
    }
    private int glyphPixels(boolean[] mask) {
        int count = 0;
        for (boolean pixel : mask) if (pixel) count++;
        return count;
    }
    private void assertPainted(String text) throws Exception {
        Rect bounds = waitText(text);
        for (int attempt = 0; attempt < 5; attempt++) {
            if (glyphPixels(glyphMask(bounds)) > 24) return;
            SystemClock.sleep(150);
        }
        throw new AssertionError("Overlay text was present but no glyphs were visible: " + text + " at " + bounds);
    }
    private void assertStable(String text) throws Exception {
        Rect bounds = waitText(text);
        SystemClock.sleep(200);
        for (int frame = 0; frame < 24; frame++) {
            if (glyphPixels(glyphMask(bounds)) <= 24)
                throw new AssertionError("Overlay text flickered: " + text + " on sample " + frame);
            SystemClock.sleep(13 + frame % 4 * 5);
        }
    }
    private void pointer(int action,float x,float y,long down,long at) {sendPointerSync(MotionEvent.obtain(down,at,action,x,y,0));}
    private void tap(Rect rect){long t=SystemClock.uptimeMillis();pointer(MotionEvent.ACTION_DOWN,rect.centerX(),rect.centerY(),t,t);pointer(MotionEvent.ACTION_UP,rect.centerX(),rect.centerY(),t,t+100);}
    private void showTools() throws Exception { if(visible("锁定")==null && visible("解锁")==null)tap(waitText("Native first line")); }
    private JSONObject type(String value)throws Exception{return new JSONObject().put("type",value);}
    @Override public void onStart() {
        Bundle result=new Bundle();
        try {
            activity=startActivitySync(new Intent().setClassName("net.ouse.nestune","net.ouse.nestune.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            for(int i=0;i<80&&web==null;i++){runOnMainSync(()->web=find(activity.getWindow().getDecorView()));SystemClock.sleep(150);}
            if(web==null)throw new AssertionError("Missing WebView");
            runOnMainSync(()->web.loadDataWithBaseURL("https://nestune.0use.net:8443/", "<!doctype html><html style='background:#111'><body></body></html>", "text/html", "UTF-8", "https://nestune.0use.net:8443/"));
            expect("location.origin==='https://nestune.0use.net:8443' && document.readyState==='complete' && typeof NestuneNative!=='undefined'");
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
            request(type("lyricsData").put("id", "qa")
                .put("lines", new org.json.JSONArray().put(new JSONObject().put("t", 20).put("text", "First sung line"))));
            request(type("lyricsLock").put("locked", true));
            request(type("lyricsMedia").put("id", "qa").put("position", 0).put("playing", true));
            assertStable("前奏");
            request(type("lyricsLock").put("locked", false));
            JSONObject data=new JSONObject("{\"type\":\"lyricsData\",\"id\":\"qa\",\"title\":\"Nestune QA\",\"plainText\":\"\",\"lines\":[{\"t\":0,\"text\":\"Native first line\",\"tr\":\"Translation one\"},{\"t\":2,\"text\":\"Native second line\",\"tr\":\"Translation two\"},{\"t\":4,\"text\":\"Native third line\"}]}");
            JSONObject lyricsOnly = new JSONObject(data.toString()).put("title", "");
            for (int i = 0; i < lyricsOnly.getJSONArray("lines").length(); i++) {
                lyricsOnly.getJSONArray("lines").getJSONObject(i).remove("tr");
            }
            request(lyricsOnly);
            request(type("lyricsMedia").put("id","qa").put("position",0.6).put("playing",false));
            assertPainted("Native first line");
            if (visible("Translation one") != null || visible("Nestune QA") != null)
                throw new AssertionError("Optional lyrics labels were present in lyrics-only mode");
            request(data);
            assertPainted("Translation one");
            assertPainted("Nestune QA");
            Rect originalSize = waitText("Native first line");
            tap(originalSize);
            tap(waitText("−"));
            SystemClock.sleep(350);
            if (waitText("Native first line").height() >= originalSize.height())
                throw new AssertionError("Lyrics did not shrink");
            assertPainted("Native first line");
            tap(waitText("+"));
            SystemClock.sleep(350);
            if (waitText("Native first line").height() != originalSize.height())
                throw new AssertionError("Lyrics did not return to the original size");
            assertPainted("Native first line");
            tap(waitText("背景")); // The dark panel makes glyphs distinguishable from the launcher.
            post(type("lyricsMedia").put("id","qa").put("position",0).put("playing",true));
            post(new JSONObject("{\"type\":\"media\",\"id\":\"qa\",\"title\":\"Nestune QA\",\"artist\":\"QA\",\"duration\":60,\"position\":0,\"playing\":true}"));
            activity.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            assertPainted("Native second line");
            assertPainted("Native third line");
            post(type("lyricsMedia").put("id","qa").put("position",2.2).put("playing",false));waitText("Native second line");SystemClock.sleep(2300);waitText("Native second line");waitText("Translation two");
            post(type("lyricsMedia").put("id","qa").put("position",0.1).put("playing",false));Rect before=waitText("Native first line");
            long t=SystemClock.uptimeMillis();pointer(MotionEvent.ACTION_DOWN,before.centerX(),before.centerY(),t,t);SystemClock.sleep(150);
            pointer(MotionEvent.ACTION_MOVE,before.centerX()+50,before.centerY()-90,t,t+180);pointer(MotionEvent.ACTION_UP,before.centerX()+50,before.centerY()-90,t,t+260);
            SystemClock.sleep(300);Rect after=waitText("Native first line");if(after.centerY()>=before.centerY()-20)throw new AssertionError("Dragging did not move overlay");
            showTools(); tap(waitText("锁定"));
            state=request(type("lyricsInfo"));if(!state.optBoolean("locked"))throw new AssertionError("Native lock button failed");
            activity.startActivity(new Intent().setClassName("net.ouse.nestune","net.ouse.nestune.MainActivity").addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
            expect("document.visibilityState==='visible'");
            js("window.__underTap=0;document.body.style.height='100vh';document.body.style.margin='0';document.addEventListener('pointerdown',()=>window.__underTap++);true");
            Rect fixed=waitText("Native first line");
            t=SystemClock.uptimeMillis();pointer(MotionEvent.ACTION_DOWN,fixed.centerX(),fixed.centerY(),t,t);
            pointer(MotionEvent.ACTION_MOVE,fixed.centerX()+50,fixed.centerY()-90,t,t+180);pointer(MotionEvent.ACTION_UP,fixed.centerX()+50,fixed.centerY()-90,t,t+260);
            SystemClock.sleep(3500);Rect still=waitText("Native first line");
            if(still.centerX()!=fixed.centerX()||still.centerY()!=fixed.centerY())throw new AssertionError("Locked overlay moved");
            js("window.__underTap=0;true");tap(waitText("Native first line"));expect("window.__underTap>0");
            tap(waitText("背景"));tap(waitText("解锁"));
            state=request(type("lyricsInfo"));if(state.optBoolean("locked"))throw new AssertionError("Native unlock button failed");
            Rect movable=waitText("Native first line");
            t=SystemClock.uptimeMillis();pointer(MotionEvent.ACTION_DOWN,movable.centerX(),movable.centerY(),t,t);
            pointer(MotionEvent.ACTION_MOVE,movable.centerX()+20,movable.centerY()-40,t,t+180);pointer(MotionEvent.ACTION_UP,movable.centerX()+20,movable.centerY()-40,t,t+260);
            SystemClock.sleep(250);if(waitText("Native first line").centerY()>=movable.centerY()-15)throw new AssertionError("Unlocked overlay could not move");
            showTools();tap(waitText("锁定"));
            getUiAutomation().setRotation(Surface.ROTATION_90);SystemClock.sleep(1000);Rect rotated=waitText("Native first line");
            int width=getTargetContext().getResources().getDisplayMetrics().widthPixels;if(rotated.left<0||rotated.right>width+2)throw new AssertionError("Rotated lyrics outside display");
            tap(waitText("解锁"));
            getUiAutomation().setRotation(Surface.ROTATION_0);SystemClock.sleep(700);
            String longText="这是一句很长的歌词用于验证滚动能够显示末尾".repeat(7);
            post(type("lyricsData").put("id","qa").put("title","Long lyric").put("lines",new org.json.JSONArray().put(new JSONObject().put("t",0).put("d",20).put("text",longText))));
            post(type("lyricsMedia").put("id","qa").put("position",0).put("playing",false));SystemClock.sleep(500);
            Rect longBounds = waitText(longText);
            boolean[] start = glyphMask(longBounds);
            if (glyphPixels(start) <= 24) throw new AssertionError("Long lyric start was blank");
            post(type("lyricsMedia").put("id","qa").put("position",19).put("playing",false));SystemClock.sleep(500);
            boolean[] end = glyphMask(longBounds);
            if (glyphPixels(end) <= 24 || Arrays.equals(start, end)) throw new AssertionError("Long lyric did not scroll");
            SystemClock.sleep(450);
            if (!Arrays.equals(end, glyphMask(longBounds))) throw new AssertionError("Paused lyric still scrolling");
            post(type("lyricsMedia").put("id","qa").put("position",0).put("playing",false));SystemClock.sleep(350);
            if (!Arrays.equals(start, glyphMask(longBounds))) throw new AssertionError("Seek did not reset scrolling");
            post(data);post(type("lyricsMedia").put("id","qa").put("position",0).put("playing",false));SystemClock.sleep(250);
            showTools();tap(waitText("锁定"));tap(waitText("关闭"));SystemClock.sleep(400);
            state=request(type("lyricsInfo"));if(state.optBoolean("enabled")||visible("Native first line")!=null)throw new AssertionError("Close failed");
            expect("window.__overlayEvents.some(e=>e.enabled===false)");
            js("const f=document.createElement('iframe');f.srcdoc='<script>setTimeout(()=>window.NestuneNative?.postMessage(JSON.stringify({type:\"lyricsEnable\",enabled:true})),20)<\\/script>';document.body.append(f);true");SystemClock.sleep(350);
            if(request(type("lyricsInfo")).optBoolean("enabled"))throw new AssertionError("Child frame controlled the overlay");
            post(new JSONObject("{\"type\":\"media\",\"id\":\"\"}"));
            result.putString("report","NESTUNE_LYRICS_RUNTIME_PASS: real native overlay over launcher, independent background clock, pause, seek, translation, drag, lock/unlock, rotation, real underlying click-through, long-line scrolling/seek/pause, native close event, child-frame denial; no login or server writes");finish(Activity.RESULT_OK,result);
        } catch(Throwable error){result.putString("failure",error.toString());try {String tree="";for(AccessibilityWindowInfo w:getUiAutomation().getWindows())tree+=describe(w.getRoot());result.putString("visibleTexts",tree);result.putString("nativeState",request(type("lyricsInfo")).toString());Class<?> c=Class.forName("net.ouse.nestune.LyricsOverlay");Object instance=null;for(java.lang.reflect.Field f:c.getDeclaredFields())if(java.lang.reflect.Modifier.isStatic(f.getModifiers())&&f.getType()==c){f.setAccessible(true);instance=f.get(null);}String views="";for(java.lang.reflect.Field f:c.getDeclaredFields()){f.setAccessible(true);Object v=f.get(instance);if(v instanceof android.widget.TextView){android.widget.TextView t=(android.widget.TextView)v;views+=t.getText()+":"+t.getWidth()+"x"+t.getHeight()+";";}}result.putString("nativeViews",views);}catch(Exception ignored){}try{result.putString("page",js("({url:location.href,ready:document.readyState,native:typeof NestuneNative})"));}catch(Exception ignored){}error.printStackTrace();finish(Activity.RESULT_CANCELED,result);}
        finally {getUiAutomation().setRotation(Surface.ROTATION_0);}
    }
}
