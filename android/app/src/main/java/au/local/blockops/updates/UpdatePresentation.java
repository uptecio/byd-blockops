package au.local.blockops.updates;

import static au.local.blockops.updates.UpdateModel.*;

/** Literal native dialog text; no HTML, paths or actions. */
public final class UpdatePresentation {
    private UpdatePresentation() {}
    public static String text(Snapshot state,String summary) {
        String text="Installed: "+state.installedVersion;
        if(state.availableVersion!=null){
            text+="\nAvailable: "+state.availableVersion+"\nDownload size: "+state.totalBytes+" bytes";
            String bounded=plainText(summary,512);
            if(!bounded.isEmpty())text+="\n\n"+bounded;
        }
        if("downloading".equals(state.phase)){
            long percent=state.totalBytes>0?state.downloadedBytes*100/state.totalBytes:0;
            text+="\nDownloaded: "+state.downloadedBytes+" / "+state.totalBytes+" bytes ("+percent+"%)";
        }
        if(!state.message.isEmpty())text+="\n\n"+state.message;
        if("ready".equals(state.phase))text+="\nAndroid may close the game during installation. You may need to reopen it.";
        return text;
    }
}
