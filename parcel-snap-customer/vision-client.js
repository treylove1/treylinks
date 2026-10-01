(() => {
  const VISION_API = SUPABASE_URL + "/functions/v1/parcel-snap-vision";

  async function analyzePackageWithVision(imageDataUrl) {
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
    if (response.status === 503 && data.error === "VISION_NOT_CONFIGURED") return null;
    if (!response.ok) throw new Error(data.error || "Vision analysis failed");
    return data.result || null;
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

  input.onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    $("receiveResult").textContent = "";
    $("receiveNewCustomerEmail").value = "";
    $("receiveNewCustomerPhone").value = "";
    intakeOcrText = "";
    intakeOcrName = "";
    intakeOcrAddress = "";

    try {
      $("processingBox").classList.remove("hidden");
      $("processingText").textContent = "Reading package…";
      $("processingDetail").textContent = "";

      const original = await readFileDataUrl(file);
      const uploadImage = await resizeDataUrl(original, 1600, .82);
      const visionImage = await resizeDataUrl(original, 1800, .90);
      const ocrImage = await resizeDataUrl(original, 2800, .96);

      intakePhotoDataUrl = uploadImage;
      $("packagePhotoPreview").innerHTML =
        '<img src="' + intakePhotoDataUrl + '" alt="Package photo">';

      let visionResult = null;
      try {
        visionResult = await analyzePackageWithVision(visionImage);
      } catch (error) {
        console.warn("Vision engine unavailable", error);
      }

      if (visionResult) {
        applyVision(visionResult);

        const support = await readPackagePhoto(ocrImage);

        if (visionResult.carrier) $("receiveCarrier").value = visionResult.carrier;
        if (visionResult.tracking_code) $("receiveTracking").value = visionResult.tracking_code;
        if (visionResult.recipient_address) intakeOcrAddress = visionResult.recipient_address;

        if (visionResult.needs_review || Number(visionResult.confidence || 0) < .78) {
          $("receiveCustomer").value = "";
          const safe = Number(visionResult.confidence || 0) >= .65
            ? String(visionResult.recipient_name || "").trim()
            : "";
          showInlineCustomer(safe);
          $("processingText").textContent = safe || "Name not clear";
          $("processingDetail").textContent = $("receiveTracking").value
            ? "Review customer · tracking captured"
            : "Review customer before saving";
        } else if (!support.match && !$("receiveCustomer").value) {
          showInlineCustomer(intakeOcrName);
        }
      } else {
        const support = await readPackagePhoto(ocrImage);
        intakeOcrAddress = support.address || "";
        if (!support.match && !support.candidate) {
          $("processingText").textContent = "Name not clear";
          $("processingDetail").textContent = $("receiveTracking").value
            ? "Vision not connected · tracking captured"
            : "Vision not connected · enter customer";
          showInlineCustomer("");
        }
      }
    } catch (error) {
      console.error(error);
      $("processingBox").classList.remove("hidden");
      $("processingText").textContent = "Name not clear";
      $("processingDetail").textContent = "Enter customer name and email";
      showInlineCustomer("");
    }
  };
})();