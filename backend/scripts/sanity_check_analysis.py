"""Quick sanity check for PCA + logistic regression analysis."""

from analysis import compute_analysis


def main() -> None:
    result = compute_analysis()
    pca = result["pca"]
    classification = result["classification"]

    print("PCA explained variance:", pca["explained_variance_ratio"])
    print("PC1 loadings:")
    for loading in pca["loadings"]:
        print(
            f"  {loading['label']:>22}: "
            f"PC1={loading['pc1']:+.3f}, PC2={loading['pc2']:+.3f}"
        )

    print()
    print("Labeled individuals:", classification["labeled_count"])
    print("Unlabeled individuals:", classification["unlabeled_count"])
    print("LOOCV accuracy:", f"{classification['loocv_accuracy']:.3f}")
    print("Confusion matrix labels:", classification["confusion_matrix"]["labels"])
    print("Confusion matrix:")
    for row in classification["confusion_matrix"]["matrix"]:
        print(" ", row)

    print()
    print("Sample unlabeled predictions:")
    for prediction in classification["predictions"][:5]:
        print(
            f"  ID {prediction['id']:>2} ({prediction['sex']}): "
            f"P(F)={prediction['probability_female']:.3f} "
            f"-> {prediction['predicted_sex']}"
        )


if __name__ == "__main__":
    main()
