(() => {
  const VISION_API = SUPABASE_URL + "/functions/v1/parcel-snap-vision";
  let visionUnavailableForSession=false;
  let packageSelectionGeneration=0;

  async function analyzePackageWithVision(imageDataUrl) {
    if(visionUnavailableForSession) return null;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;

    const response = await fetch(VISION_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + session.access_token,
        "apikey": SUPABASE_KEY
      },
      body: JSON.stringify({ image_data_url: imageDataUrl })
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 503 && data.error === "VISION_NOT_CONFIGURED") {
      visionUnavailableForSession=true;
      return null;
    }
    if (!response.ok) throw new Error(data.error || "Vision analysis failed");
    if(!window.ParcelSnapVisionResult)throw new Error("Vision result validation is unavailable");
    return window.ParcelSnapVisionResult.normalize(data);
  }

  function bestDirectoryMatch(name, confidence) {
    if (!name || !workspace?.customers?.length || Number(confidence || 0) < 0.65) return null;

    const ranked = workspace.customers
      .map(customer => ({
        customer,
        score: candidateScore(customer.name, name)
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const second = ranked[1];
    if (!best) return null;

    const threshold = confidence >= 0.85 ? 0.76 : 0.86;
    return best.score >= threshold && (!second || best.score - second.score >= 0.07)
      ? best.customer
      : null;
  }

  function applyVision(result) {
    if (!result) return false;

    const confidence = Number(result.confidence || 0);
    const match = bestDirectoryMatch(result.recipient_name, confidence);

    if (result.carrier && !$("receiveCarrier").value) $("receiveCarrier").value = result.carrier;
    if (result.tracking_code) $("receiveTracking").value = result.tracking_code;
    if (result.recipient_address) intakeOcrAddress = result.recipient_address;

    if (match && !result.needs_review) {
      $("receiveCustomer").value = match.id;
      hideInlineCustomer();
      intakeOcrName = match.name;
      $("processingText").textContent = match.name;
      $("processingDetail").textContent = result.tracking_code
        ? "Vision matched customer · tracking captured"
        : "Vision matched customer";
      return true;
    }

    $("receiveCustomer").value = "";
    const safeName = confidence >= 0.65 ? String(result.recipient_name || "").trim() : "";
    intakeOcrName = safeName;
    showInlineCustomer(safeName);
    $("processingText").textContent = safeName || "Name not clear";
    $("processingDetail").textContent = result.tracking_code
      ? "Review customer · tracking captured"
      : "Review customer before saving";
    return true;
  }

  const input = $("packagePhoto");
  if (!input) return;

  function visionDirectoryMatch(result){
    if(!result||!workspace?.customers?.length)return null;

    const evidence=[
      result.recipient_business,
      result.recipient_name,
      result.recipient_address
    ].filter(Boolean).join("\n");

    if(window.ParcelSnapKnownMatcher&&evidence){
      const matched=window.ParcelSnapKnownMatcher.matchDirectory(workspace.customers,evidence);
      if(matched.status==="MATCHED"&&matched.customer)return matched.customer;
      return null;
    }

    if(!result.recipient_name)return null;
    return bestDirectoryMatch(result.recipient_name,Number(result.confidence||0));
  }

  function refineFromVision(result,local){
    if(!result||receiveInFlight)return;
    if(local?.edit_generation!==intakeFieldEditGeneration)return;
    resetLabelConfirmation();
    intakeVisionWarnings=(result.review_warnings||[]).map(warning=>warning.message).filter(Boolean);

    if(result.carrier&&!$("receiveCarrier").value)$("receiveCarrier").value=result.carrier;
    const trackingEdited=intakeTrackingReview?.manual||intakeTrackingReview?.status==="MANUAL";
    if(result.tracking_candidates?.length>1){
      intakeTrackingReview={status:"CONFLICT",manual:trackingEdited,message:"The reader returned conflicting tracking values — check the photo"};
      if(!trackingEdited)$("receiveTracking").value="";
    }else if(result.tracking_code){
      const tracking=trackingAnalysis("CARRIER: "+(result.carrier||"")+"\nTRACKING: "+result.tracking_code);
      const current=$("receiveTracking").value.trim();
      if(current&&tracking.value&&current.toUpperCase()!==tracking.value.toUpperCase()){
        if(!trackingEdited)$("receiveTracking").value="";
        intakeTrackingReview={status:"CONFLICT",manual:trackingEdited,message:"OCR and vision tracking disagree — check the photo"};
      }else if(!current&&!trackingEdited){
        $("receiveTracking").value=tracking.value;
        intakeTrackingReview=tracking;
      }
    }
    if(result.recipient_address&&!intakeOcrAddress)intakeOcrAddress=result.recipient_address;

    const vMatch=visionDirectoryMatch(result);
    const manualName=intakeRecipientDisplay?.read_token===intakeReadToken
      && intakeRecipientDisplay.source==="manual";
    if(manualName||($("receiveCustomer").value&&!local?.match))return;
    if(local?.candidate&&result.recipient_name&&candidateScore(local.candidate,result.recipient_name)<.90){
      $("receiveCustomer").value="";
      showInlineCustomer(local.candidate);
      $("processingText").textContent="Customer needs review";
      $("processingDetail").textContent="OCR and vision disagree — choose customer";
      return;
    }

    if(local?.match){
      if(vMatch&&vMatch.id===local.match.customer.id&&!result.needs_review){
        $("processingDetail").textContent=$("receiveTracking").value
          ?"Customer matched · tracking captured · AI confirmed"
          :"Customer matched · AI confirmed";
      }else if(vMatch&&vMatch.id!==local.match.customer.id){
        $("receiveCustomer").value="";
        showInlineCustomer("");
        $("processingText").textContent="Customer needs review";
        $("processingDetail").textContent="OCR and vision disagree — choose customer";
      }
      return;
    }

    if(vMatch&&!result.needs_review&&Number(result.confidence||0)>=.78){
      $("receiveCustomer").value=vMatch.id;
      hideInlineCustomer();
      intakeOcrName=vMatch.name;
      $("processingText").textContent=vMatch.name;
      $("processingDetail").textContent=result.tracking_code
        ?"Vision matched customer · tracking captured"
        :"Vision matched customer";
      return;
    }

    if(!$("receiveCustomer").value){
      const safe=Number(result.confidence||0)>=.65
        ?String(result.recipient_name||"").trim()
        :"";
      if(safe&&!$("receiveNewCustomerName").value){
        $("receiveNewCustomerName").value=safe;
        // Do not change intakeOcrName: background recovery uses it as an eligibility guard.
        intakeRecipientDisplay={name:safe,read_token:intakeReadToken,source:"vision"};
        $("processingText").textContent=safe;
        $("processingDetail").textContent="Possible recipient — verify against the photo";
      }
    }
  }

  input.onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    if(receiveInFlight)return;
    clearInactivePhotoSource("packagePhoto","packagePhotoGallery",event.target);
    const startedAt=performance.now();
    const selectionGeneration=++packageSelectionGeneration;
    const selectionToken=++intakeReadToken;
    const editGeneration=intakeFieldEditGeneration;
    intakePhotoDataUrl=null;
    intakePhotoPending=true;
    stopRecoveryOcr();

    $("receiveResult").textContent = "";
    $("receiveNewCustomerEmail").value = "";
    $("receiveNewCustomerPhone").value = "";
    $("receiveNewCustomerAlias").value = "";
    $("receiveAddress").value = "";
    intakePackageId=crypto.randomUUID();
    intakeOcrText = "";
    intakeOcrName = "";
    intakeRecipientDisplay=null;
    intakeTrackingReview=null;
    intakeVisionWarnings=[];
    resetLabelConfirmation();
    intakeOcrAddress = "";
    $("receiveCustomer").value="";
    $("receiveTracking").value="";
    $("receiveCarrier").value="";
    $("receiveNewCustomerName").value="";
    $("labelReadout").classList.add("hidden");

    let instantUrl=null;
    try {
      $("processingBox").classList.remove("hidden");
      $("processingText").textContent = "Reading package…";
      $("processingDetail").textContent = "";

      // Instant visual feedback before any OCR/image preparation work.
      instantUrl=URL.createObjectURL(file);
      $("packagePhotoPreview").innerHTML=
        '<img src="' + instantUrl + '" alt="Package photo">';

      // Yield one frame so the employee sees the photo immediately.
      await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
      if(selectionGeneration!==packageSelectionGeneration)return;

      const prepared=await preparePackageImages(file);
      if(selectionGeneration!==packageSelectionGeneration)return;
      intakePhotoDataUrl=prepared.preview;
      // Review the exact encoded image that receivePackage submits and stores.
      $("packagePhotoPreview").innerHTML=
        '<img src="' + intakePhotoDataUrl + '" alt="Package photo">';

      const visionPromise=analyzePackageWithVision(prepared.vision)
        .catch(error=>{
          console.warn("Vision engine unavailable",error);
          return null;
        });

      // Do not wait for remote vision. Local OCR owns the fast path.
      const local=await readPackagePhoto(prepared.ocrCanvas,{raw:prepared.rawOcrCanvas,startedAt,readToken:selectionToken,editGeneration});
      if(selectionGeneration!==packageSelectionGeneration||local?.superseded)return;
      intakeOcrAddress=local.address||"";

      visionPromise.then(async result=>{
        if(result&&selectionGeneration===packageSelectionGeneration&&!local?.superseded&&local?.read_token===intakeReadToken){
          refineFromVision(result,local);
          renderLabelReadout();
        }
        if(selectionGeneration===packageSelectionGeneration&&local?.read_token===intakeReadToken){
          await autoReceiveMatchedPhoto(local,result);
        }
      }).catch(error=>{console.warn("Automatic intake failed",error);});

      if(prepared.label_crop_used){
        const detail=$("processingDetail").textContent;
        $("processingDetail").textContent=detail
          ?detail+" · label "+prepared.crop_width+"×"+prepared.crop_height
          :"Label crop used";
      }
    } catch (error) {
      if(selectionGeneration!==packageSelectionGeneration)return;
      console.error(error);
      $("processingBox").classList.remove("hidden");
      if(editGeneration===intakeFieldEditGeneration){
        $("processingText").textContent = "Name not clear";
        showInlineCustomer("");
      }
      $("processingDetail").textContent = "Enter customer name and email";
      if(!intakePhotoDataUrl){
        $("packagePhotoPreview").innerHTML="";
        $("processingDetail").textContent="Could not open this image. Choose a JPG, PNG or WebP photo, or take another photo.";
      }
    } finally {
      if(instantUrl)URL.revokeObjectURL(instantUrl);
      if(selectionGeneration===packageSelectionGeneration)intakePhotoPending=false;
    }
  };
})();
