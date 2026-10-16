package au.local.blockops.updates;

import android.content.Context;
import android.content.SharedPreferences;
import java.net.URI;
import java.util.Collections;
import org.json.JSONObject;
import static au.local.blockops.updates.UpdateModel.*;
import static au.local.blockops.updates.UpdatePorts.*;

/** Dedicated updater preferences. Each commit changes only state fields or the session field. */
public final class UpdatePreferences implements StateStore, SessionStore {
    private final SharedPreferences preferences;
    public UpdatePreferences(Context context){preferences=context.getSharedPreferences("block-ops-updater-v1",Context.MODE_PRIVATE);}
    @Override public synchronized SavedState load(){
        Release release=null;
        try{
            String encoded=preferences.getString("release",null);
            if(encoded!=null&&encoded.length()<=16384){
                JSONObject data=new JSONObject(encoded);String tag=data.getString("tag");
                Asset asset=new Asset(data.getLong("assetId"),data.getString("name"),URI.create(data.getString("uri")),
                    data.getLong("size"),data.isNull("digest")?null:data.getString("digest"));
                UpdatePolicy.select(tag,false,false,Collections.singletonList(asset));
                String sha=data.getString("sha256");if(!sha.matches("[0-9a-f]{64}"))throw new IllegalArgumentException();
                if(asset.digest!=null&&!UpdatePolicy.digest(asset.digest,null,asset.name).equals(sha))throw new IllegalArgumentException();
                long id=data.getLong("id");if(id<=0)throw new IllegalArgumentException();
                release=new Release(id,tag,UpdatePolicy.parseVersion(tag,true),asset,sha,data.optString("summary",""));
            }
        }catch(Exception corrupt){/* Invalid cache never becomes a download offer. */}
        return new SavedState(number("success"),number("failure"),number("retry"),release);
    }
    @Override public synchronized void save(SavedState state)throws Failure {
        try{
            SharedPreferences.Editor edit=preferences.edit().putLong("success",state.lastSuccessWallMillis)
                .putLong("failure",state.lastFailureWallMillis).putLong("retry",state.serverRetryUntilWallMillis);
            Release r=state.cachedRelease;
            if(r==null)edit.remove("release");
            else edit.putString("release",new JSONObject().put("id",r.id).put("tag",r.tag).put("assetId",r.asset.id)
                .put("name",r.asset.name).put("uri",r.asset.uri.toString()).put("size",r.asset.size)
                .put("digest",r.asset.digest==null?JSONObject.NULL:r.asset.digest).put("sha256",r.sha256).put("summary",r.summary).toString());
            if(!edit.commit())throw failed();
        }catch(org.json.JSONException|RuntimeException failure){throw failed();}
    }
    @Override public synchronized Integer get()throws Failure {
        try{int id=preferences.getInt("session",-1);return id>=0?id:null;}catch(RuntimeException corrupt){throw failed();}
    }
    @Override public synchronized void set(Integer id)throws Failure {
        SharedPreferences.Editor edit=preferences.edit();if(id==null)edit.remove("session");else if(id>=0)edit.putInt("session",id);else throw failed();
        if(!edit.commit())throw failed();
    }
    private long number(String name){try{return preferences.getLong(name,0);}catch(RuntimeException corrupt){return 0;}}
    private static Failure failed(){return new Failure("updater_storage","Update state could not be saved. Please try again.");}
}
